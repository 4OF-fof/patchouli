//! CLI・拡張機能・ほかのアプリからの要求を受けるパイプ。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use interprocess::local_socket::{ListenerOptions, Stream, prelude::*};
use serde_json::{Value, json};
use tauri::AppHandle;

use crate::remote::proto::{
    self, ACTIVATE, DENIED, FAILED, HELLO, INVALID, NOT_FOUND, PARSE_ERROR, PERMISSIONS,
};
use crate::remote::{clients, ops};
use crate::shell::{settings, tray};

/// ほかに動いているアプリがあれば true。activate なら、そちらのウィンドウを出してもらう。
pub fn running(activate: bool) -> bool {
    let Ok(name) = proto::socket_name() else {
        return false;
    };
    let Ok(conn) = Stream::connect(name) else {
        return false;
    };
    if activate {
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": ACTIVATE });
        if (&conn).write_all(format!("{req}\n").as_bytes()).is_ok() {
            let _ = BufReader::new(&conn).read_line(&mut String::new());
        }
    }
    true
}

pub fn start(app: &AppHandle) {
    let listener = match proto::socket_name().and_then(|name| {
        ListenerOptions::new()
            .name(name)
            .try_overwrite(true)
            .create_sync()
    }) {
        Ok(l) => l,
        Err(e) => {
            log::warn!("外からの操作を受けるパイプを作れない: {e}");
            return;
        }
    };
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            match listener.accept() {
                Ok(conn) => {
                    let app = app.clone();
                    std::thread::spawn(move || serve(&app, conn));
                }
                Err(e) => log::warn!("外からの接続を受けられない: {e}"),
            }
        }
    });
}

/// つないでいる口。応答のほかに、アプリから知らせ（id のない JSON-RPC の要求）を送る。
struct Peer {
    conn: Stream,
    /// 応答と知らせの行が混ざらないように、1 行ずつ書く
    writing: Mutex<()>,
}

impl Peer {
    fn send(&self, v: &Value) -> std::io::Result<()> {
        let _held = self.writing.lock().unwrap_or_else(|e| e.into_inner());
        (&self.conn).write_all(format!("{v}\n").as_bytes())
    }
}

static PEERS: LazyLock<Mutex<HashMap<u64, Arc<Peer>>>> = LazyLock::new(Mutex::default);
static NEXT_PEER: AtomicU64 = AtomicU64::new(1);

/// peer の口に知らせを送る。
pub fn notify(peer: u64, method: &str, params: Value) -> Result<(), String> {
    let found = PEERS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&peer)
        .cloned();
    let p = found.ok_or("接続が切れています")?;
    p.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
        .map_err(|e| format!("接続が切れています：{e}"))
}

fn serve(app: &AppHandle, conn: Stream) {
    let peer = Arc::new(Peer {
        conn,
        writing: Mutex::new(()),
    });
    let id = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
    let peers = || PEERS.lock().unwrap_or_else(|e| e.into_inner());
    peers().insert(id, Arc::clone(&peer));
    let mut client: Option<String> = None;
    for line in BufReader::new(&peer.conn).lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Some(reply) = respond(app, id, &mut client, &line) else {
            continue;
        };
        if peer.send(&reply).is_err() {
            break;
        }
    }
    peers().remove(&id);
}

fn respond(app: &AppHandle, peer: u64, client: &mut Option<String>, line: &str) -> Option<Value> {
    let req: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": PARSE_ERROR, "message": format!("JSON の読み込みに失敗しました：{e}") },
            }));
        }
    };
    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = dispatch(app, peer, client, method, &params);
    let id = req.get("id")?.clone();
    Some(match result {
        Ok(v) => json!({ "jsonrpc": "2.0", "id": id, "result": v }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    })
}

/// 名乗りから、口の key と、画面に出す名前を決める。
fn identify(app: &AppHandle, p: &Value) -> Result<(String, String), String> {
    let name = p
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match p.get("client").and_then(Value::as_str) {
        Some("cli") => Ok(("cli".into(), "CLI".into())),
        Some("extension") => {
            let id = p
                .get("extension")
                .and_then(Value::as_str)
                .ok_or("拡張機能の ID が指定されていません")?;
            if !settings::remote(app)?.extensions.iter().any(|x| x == id) {
                return Err(format!("拡張機能「{id}」は登録されていません"));
            }
            Ok((
                format!("extension:{id}"),
                name.map_or_else(|| format!("拡張機能（{id}）"), str::to_owned),
            ))
        }
        Some("app") => {
            let name = name.ok_or("アプリの名前（name）を指定してください")?;
            Ok((format!("app:{name}"), name.to_owned()))
        }
        _ => Err("client には cli・extension・app のいずれかを指定してください".into()),
    }
}

fn dispatch(
    app: &AppHandle,
    peer: u64,
    client: &mut Option<String>,
    method: &str,
    p: &Value,
) -> Result<Value, (i64, String)> {
    if method == ACTIVATE {
        tray::show_main(app);
        return Ok(Value::Null);
    }
    if method == HELLO {
        let (key, name) = identify(app, p).map_err(|e| (INVALID, e))?;
        let wanted = match p.get("permissions").and_then(Value::as_array) {
            Some(a) => a
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            None => PERMISSIONS.iter().map(|s| (*s).to_owned()).collect(),
        };
        let granted = clients::grant(app, &key, &name, wanted).map_err(|e| (DENIED, e))?;
        *client = Some(key);
        return Ok(json!({
            "permissions": granted,
            "version": app.package_info().version.to_string(),
        }));
    }
    let Some(key) = client.as_deref() else {
        return Err((DENIED, "最初に hello で名乗ってください".into()));
    };
    let op =
        proto::op(method).ok_or_else(|| (NOT_FOUND, format!("操作「{method}」は存在しません")))?;
    let granted = clients::current(app, key).map_err(|e| (DENIED, e))?;
    if !granted.iter().any(|g| g == op.permission) {
        return Err((
            DENIED,
            format!(
                "権限「{}」が許可されていません",
                proto::permission_label(op.permission)
            ),
        ));
    }
    ops::call(app, peer, method, p).map_err(|e| (FAILED, e))
}
