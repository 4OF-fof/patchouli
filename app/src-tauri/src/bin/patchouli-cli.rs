//! 動いている Patchouli を操作する CLI。ブラウザの拡張機能から呼ぶ Native Messaging のホストも兼ねる。
//! アプリの本体は大きいので、ライブラリのクレートは使わず、決まりを書いた proto.rs だけを読む。

#[path = "../remote/proto.rs"]
#[allow(dead_code)]
mod proto;

use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use interprocess::local_socket::{Stream, prelude::*};
use serde_json::{Map, Value, json};

use proto::{HELLO, Kind, OPS, Op, PERMISSIONS, Param};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const COMMAND: &str = "patchouli";
/// アプリを起動してから、つながるまで待つ長さ。
const LAUNCH_WAIT: Duration = Duration::from_secs(30);
/// Native Messaging でブラウザに返せる大きさ。
const NATIVE_LIMIT: usize = 1 << 20;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Chromium 系は拡張機能の origin を、Firefox はホストの記述のパスと拡張機能の ID を渡して起動する
    if let Some(first) = args.first() {
        if let Some(rest) = first.strip_prefix("chrome-extension://") {
            return native(rest.trim_end_matches('/'));
        }
        if args.len() >= 2 && first.ends_with(".json") && Path::new(first).is_file() {
            return native(&args[1]);
        }
    }
    match args.first().map(String::as_str) {
        None | Some("help" | "--help" | "-h") => {
            help(args.get(1..).unwrap_or_default());
            ExitCode::SUCCESS
        }
        Some("--version" | "-V" | "version") => {
            println!("{COMMAND} {VERSION}");
            ExitCode::SUCCESS
        }
        _ => run(&args),
    }
}

enum CallError {
    /// つなぎ直せば通るかもしれないもの
    Io(String),
    Rpc(String),
}

impl CallError {
    fn message(self) -> String {
        match self {
            CallError::Io(m) | CallError::Rpc(m) => m,
        }
    }
}

struct Conn {
    stream: BufReader<Stream>,
    next: u64,
}

impl Conn {
    /// つないで名乗る。hello の結果も返す。
    fn open(hello: Value) -> Result<(Conn, Value), String> {
        let mut c = Conn {
            stream: BufReader::new(connect_or_launch()?),
            next: 1,
        };
        let r = c.call(HELLO, hello).map_err(CallError::message)?;
        Ok((c, r))
    }

    fn exchange(&mut self, req: &Value) -> Result<Value, CallError> {
        let io = |e: io::Error| CallError::Io(format!("Patchouli との接続が切れました：{e}"));
        let mut w = self.stream.get_ref();
        w.write_all(format!("{req}\n").as_bytes()).map_err(io)?;
        // アプリからの知らせ（id のないもの）は読み飛ばす
        loop {
            let mut line = String::new();
            if self.stream.read_line(&mut line).map_err(io)? == 0 {
                return Err(CallError::Io("Patchouli との接続が切れました".into()));
            }
            let v: Value = serde_json::from_str(&line)
                .map_err(|e| CallError::Rpc(format!("応答の読み込みに失敗しました：{e}")))?;
            if v.get("id").is_some() {
                return Ok(v);
            }
        }
    }

    fn call(&mut self, method: &str, params: Value) -> Result<Value, CallError> {
        let id = self.next;
        self.next += 1;
        let r = self
            .exchange(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        if let Some(e) = r.get("error") {
            let m = e
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("失敗しました");
            return Err(CallError::Rpc(m.to_owned()));
        }
        Ok(r.get("result").cloned().unwrap_or(Value::Null))
    }
}

fn hello(client: &str) -> Value {
    json!({ "client": client, "permissions": PERMISSIONS })
}

fn connect() -> io::Result<Stream> {
    Stream::connect(proto::socket_name()?)
}

/// アプリの実行ファイル。PATH に写した CLI は、隣の app-path に場所が書いてある。
fn app_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe = exe.canonicalize().unwrap_or(exe);
    let dir = exe.parent()?;
    if let Ok(s) = std::fs::read_to_string(dir.join("app-path")) {
        let p = PathBuf::from(s.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    ["Patchouli", "patchouli"]
        .iter()
        .map(|n| dir.join(format!("{n}{}", std::env::consts::EXE_SUFFIX)))
        .find(|p| p.is_file() && p.canonicalize().ok().as_ref() != Some(&exe))
}

fn launch(app: &Path) -> io::Result<()> {
    let mut c = Command::new(app);
    c.arg("--background")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // ブラウザがこのプロセスを片付けても、アプリは残す
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        c.creation_flags(CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP);
        if c.spawn().is_ok() {
            return Ok(());
        }
        c.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    c.spawn().map(drop)
}

fn connect_or_launch() -> Result<Stream, String> {
    if let Ok(s) = connect() {
        return Ok(s);
    }
    let app = app_path().ok_or("Patchouli が見つかりません")?;
    launch(&app).map_err(|e| format!("{}: {e}", app.display()))?;
    let until = Instant::now() + LAUNCH_WAIT;
    loop {
        match connect() {
            Ok(s) => return Ok(s),
            Err(_) if Instant::now() < until => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => return Err(format!("Patchouli に接続できませんでした：{e}")),
        }
    }
}

fn help(words: &[String]) {
    let found = (!words.is_empty())
        .then(|| {
            OPS.iter()
                .find(|o| !o.cli.is_empty() && o.cli.iter().eq(words.iter()))
        })
        .flatten();
    if let Some(op) = found {
        println!("{}\n    {}", proto::usage(COMMAND, op), op.summary);
        for p in op.params {
            println!("    {}: {}", flag_name(p), p.help);
        }
        return;
    }
    println!("Patchouli の CLI {VERSION}\n");
    println!("使い方: {COMMAND} <コマンド> [引数] [--json]\n");
    println!(
        "動いている Patchouli のライブラリを操作します。アプリが動いていなければ、トレイに常駐する形で起動します。"
    );
    println!(
        "--json を付けると、結果を JSON で表示します。文を受け取るオプションに「-」を渡すと、標準入力から読み込みます。\n"
    );
    print!("{}", proto::reference(COMMAND));
}

fn flag_name(p: &Param) -> String {
    if p.positional {
        p.flag.to_owned()
    } else {
        format!("--{}", p.flag)
    }
}

fn read_stdin() -> Result<String, String> {
    let mut s = String::new();
    io::stdin()
        .read_to_string(&mut s)
        .map_err(|e| format!("標準入力の読み込みに失敗しました：{e}"))?;
    Ok(s)
}

fn put(m: &mut Map<String, Value>, p: &Param, v: &str) -> Result<(), String> {
    let v = match p.kind {
        Kind::Text if v == "-" => json!(read_stdin()?),
        Kind::Str | Kind::Text => json!(v),
        Kind::Int => json!(
            v.parse::<u64>()
                .map_err(|_| format!("{} には数を指定してください（指定：{v}）", flag_name(p)))?
        ),
        Kind::Bool => json!(v != "false"),
        Kind::List => {
            let list = m.entry(p.name).or_insert_with(|| json!([]));
            if let Value::Array(a) = list {
                a.push(json!(v));
            }
            return Ok(());
        }
    };
    m.insert(p.name.to_owned(), v);
    Ok(())
}

fn parse(op: &Op, rest: &[&str]) -> Result<Map<String, Value>, String> {
    let mut m = Map::new();
    let positional: Vec<&Param> = op.params.iter().filter(|p| p.positional).collect();
    let mut at = 0;
    let mut i = 0;
    while i < rest.len() {
        let a = rest[i];
        if let Some(flag) = a.strip_prefix("--").filter(|f| !f.is_empty()) {
            let (flag, inline) = match flag.split_once('=') {
                Some((f, v)) => (f, Some(v)),
                None => (flag, None),
            };
            let p = op
                .params
                .iter()
                .find(|p| !p.positional && p.flag == flag)
                .ok_or_else(|| format!("オプション「--{flag}」は存在しません"))?;
            if p.kind == Kind::Bool {
                put(&mut m, p, inline.unwrap_or("true"))?;
            } else {
                let v = match inline {
                    Some(v) => v,
                    None => {
                        i += 1;
                        rest.get(i)
                            .copied()
                            .ok_or_else(|| format!("--{flag} に値を指定してください"))?
                    }
                };
                put(&mut m, p, v)?;
            }
        } else {
            let p = positional
                .get(at)
                .ok_or_else(|| format!("引数「{a}」は使用できません"))?;
            put(&mut m, p, a)?;
            if p.kind != Kind::List {
                at += 1;
            }
        }
        i += 1;
    }
    for p in op.params.iter().filter(|p| p.required) {
        if m.contains_key(p.name) {
            continue;
        }
        let name = if p.positional {
            format!("<{}>", p.flag)
        } else {
            format!("--{}", p.flag)
        };
        return Err(format!("{name} を指定してください"));
    }
    // アプリは別の場所で動いているので、相対パスはここで絶対パスにする
    if let Some(Value::Array(paths)) = m.get_mut("paths") {
        for v in paths.iter_mut() {
            if let Some(s) = v.as_str()
                && let Ok(abs) = std::path::absolute(s)
            {
                *v = json!(abs);
            }
        }
    }
    Ok(m)
}

fn run(args: &[String]) -> ExitCode {
    let as_json = args.iter().any(|a| a == "--json");
    let args: Vec<&str> = args
        .iter()
        .map(String::as_str)
        .filter(|a| *a != "--json")
        .collect();
    let op = OPS
        .iter()
        .filter(|o| {
            !o.cli.is_empty()
                && args.len() >= o.cli.len()
                && o.cli.iter().zip(&args).all(|(a, b)| a == b)
        })
        .max_by_key(|o| o.cli.len());
    let Some(op) = op else {
        eprintln!(
            "コマンド「{}」は存在しません。{COMMAND} help でコマンドの一覧を表示します",
            args.join(" ")
        );
        return ExitCode::from(2);
    };
    let rest = &args[op.cli.len()..];
    if rest.iter().any(|a| *a == "--help" || *a == "-h") {
        help(&op.cli.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>());
        return ExitCode::SUCCESS;
    }
    let params = match parse(op, rest) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}\n使い方: {}", proto::usage(COMMAND, op));
            return ExitCode::from(2);
        }
    };
    let result = Conn::open(hello("cli")).and_then(|(mut c, _)| {
        c.call(op.method, Value::Object(params))
            .map_err(CallError::message)
    });
    match result {
        Ok(v) if as_json => {
            println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            ExitCode::SUCCESS
        }
        Ok(v) => {
            show(op, &v);
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn strs(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn file_name(it: &Value) -> String {
    let (name, ext) = (str_of(it, "name"), str_of(it, "ext"));
    if str_of(it, "type") == "note" || ext.is_empty() {
        name.to_owned()
    } else {
        format!("{name}.{ext}")
    }
}

fn place(it: &Value) -> String {
    let project = str_of(it, "project");
    let group = str_of(it, "groupName");
    match (project.is_empty(), group.is_empty()) {
        (true, true) => String::new(),
        (false, true) => project.to_owned(),
        (true, false) => group.to_owned(),
        (false, false) => format!("{project} / {group}"),
    }
}

fn item_line(it: &Value) -> String {
    let mut s = format!("{}  {}", str_of(it, "id"), file_name(it));
    let at = place(it);
    if !at.is_empty() {
        s.push_str(&format!("  [{at}]"));
    }
    let tags = strs(it, "tags");
    if !tags.is_empty() {
        s.push_str("  ");
        s.push_str(
            &tags
                .iter()
                .map(|t| format!("#{t}"))
                .collect::<Vec<_>>()
                .join(" "),
        );
    }
    s
}

/// ミリ秒を UTC の日時にする。
fn utc(ms: f64) -> String {
    let secs = (ms / 1000.0).floor() as i64;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02} UTC",
        rem / 3600,
        rem % 3600 / 60
    )
}

fn show_item(it: &Value) {
    let rows = [
        ("ID", str_of(it, "id").to_owned()),
        ("名前", file_name(it)),
        (
            "種類",
            if str_of(it, "type") == "note" {
                "ノート".into()
            } else {
                "素材".into()
            },
        ),
        ("場所", place(it)),
        ("タグ", strs(it, "tags").join(", ")),
        ("別名", strs(it, "aliases").join(", ")),
        ("メモ", str_of(it, "memo").to_owned()),
        ("URL", str_of(it, "url").to_owned()),
        ("ファイル", str_of(it, "file").to_owned()),
        (
            "大きさ",
            match (it.get("width"), it.get("height")) {
                (Some(w), Some(h)) => format!("{w} × {h}"),
                _ => String::new(),
            },
        ),
        (
            "更新",
            it.get("mtime")
                .and_then(Value::as_f64)
                .map(utc)
                .unwrap_or_default(),
        ),
    ];
    for (k, v) in rows {
        if !v.is_empty() {
            println!("{k}: {v}");
        }
    }
}

fn show(op: &Op, v: &Value) {
    match (op.method, v) {
        (_, Value::Null) => {}
        (_, Value::String(s)) => {
            print!("{s}");
            if !s.ends_with('\n') {
                println!();
            }
        }
        ("items.list", _) => {
            let items = v
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for it in &items {
                println!("{}", item_line(it));
            }
            let total = v.get("total").and_then(Value::as_u64).unwrap_or(0);
            println!("{total} 件中 {} 件を表示", items.len());
        }
        ("items.import", _) => {
            for it in v
                .get("items")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                println!("{}", item_line(it));
            }
            let n = v.get("items").and_then(Value::as_array).map_or(0, Vec::len);
            let skipped = v.get("skipped").and_then(Value::as_u64).unwrap_or(0);
            let failed = strs(v, "failed");
            println!("{n} 件を取り込みました");
            if skipped > 0 {
                println!("{skipped} 件はライブラリ内のファイルなどのためスキップしました");
            }
            for f in failed {
                eprintln!("取り込みに失敗しました：{f}");
            }
        }
        ("search.content", Value::Array(a)) => {
            for it in a {
                let score = it.get("score").and_then(Value::as_f64).unwrap_or(0.0);
                println!("{:.3}  {}", score, item_line(it));
            }
        }
        ("tags.list", Value::Array(a)) => {
            for t in a {
                println!(
                    "{}  {}",
                    str_of(t, "tag"),
                    t.get("count").and_then(Value::as_u64).unwrap_or(0)
                );
            }
        }
        ("projects.list", _) => {
            println!("プロジェクト");
            for p in v
                .get("projects")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let n = p.get("count").and_then(Value::as_u64).unwrap_or(0);
                println!("  {}  {n} 件", str_of(p, "name"));
            }
            println!("グループ");
            for g in v
                .get("groups")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let project = str_of(g, "project");
                let at = if project.is_empty() {
                    String::new()
                } else {
                    format!("  [{project}]")
                };
                println!("  {}  {}{at}", str_of(g, "id"), str_of(g, "name"));
            }
        }
        ("library.info", _) => {
            println!("ライブラリ: {}", str_of(v, "name"));
            println!("場所: {}", str_of(v, "root"));
            for (k, label) in [
                ("assets", "素材"),
                ("notes", "ノート"),
                ("projects", "プロジェクト"),
                ("groups", "グループ"),
                ("tags", "タグ"),
            ] {
                println!(
                    "{label}: {} 件",
                    v.get(k).and_then(Value::as_u64).unwrap_or(0)
                );
            }
        }
        (_, Value::Object(o)) if o.contains_key("id") && o.contains_key("type") => show_item(v),
        _ => println!("{}", serde_json::to_string_pretty(v).unwrap_or_default()),
    }
}

fn read_frame(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match input.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let mut buf = vec![0; u32::from_ne_bytes(len) as usize];
    input.read_exact(&mut buf)?;
    Ok(Some(buf))
}

fn write_frame(out: &mut impl Write, v: &Value) -> io::Result<()> {
    let mut bytes = v.to_string().into_bytes();
    if bytes.len() > NATIVE_LIMIT {
        bytes = json!({
            "jsonrpc": "2.0",
            "id": v.get("id"),
            "error": { "code": proto::FAILED, "message": "応答が 1 MB を超えたため送信できません。limit を小さくしてください" },
        })
        .to_string()
        .into_bytes();
    }
    out.write_all(&(bytes.len() as u32).to_ne_bytes())?;
    out.write_all(&bytes)?;
    out.flush()
}

fn rpc_error(id: Value, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": proto::FAILED, "message": message } })
}

/// ブラウザへ 1 件送る。応答と知らせを別のスレッドから送るので、1 件ずつまとめて書く。
fn to_browser(v: &Value) -> io::Result<()> {
    write_frame(&mut io::stdout().lock(), v)
}

/// 名乗り終えたパイプ。届いた応答と知らせは、裏のスレッドが届いた順にブラウザへ渡す。
struct Bridge {
    stream: Arc<Stream>,
    /// 応答を待っている要求の id。切れたら None にして、待っていたものにエラーを返す
    pending: Arc<Mutex<Option<Vec<Value>>>>,
}

impl Bridge {
    fn open(hello: Value) -> Result<(Bridge, Value), String> {
        let (c, r) = Conn::open(hello)?;
        let left = c.stream.buffer().to_vec();
        let stream = Arc::new(c.stream.into_inner());
        let pending = Arc::new(Mutex::new(Some(Vec::new())));
        let (s, p) = (Arc::clone(&stream), Arc::clone(&pending));
        std::thread::spawn(move || relay(&s, left, &p));
        Ok((Bridge { stream, pending }, r))
    }

    fn pending(&self) -> MutexGuard<'_, Option<Vec<Value>>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn alive(&self) -> bool {
        self.pending().is_some()
    }

    /// 送れなかったら、エラーとして返す応答。
    fn send(&self, req: &Value) -> Option<Value> {
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        match self.pending().as_mut() {
            Some(list) => list.push(id.clone()),
            None => return Some(rpc_error(id, "Patchouli との接続が切れました".into())),
        }
        let e = (&*self.stream)
            .write_all(format!("{req}\n").as_bytes())
            .err()?;
        // 裏のスレッドが先にエラーを返していなければ、ここで返す
        let mut held = self.pending();
        let list = held.as_mut()?;
        let at = list.iter().position(|x| *x == id)?;
        list.remove(at);
        Some(rpc_error(
            id,
            format!("Patchouli との接続が切れました：{e}"),
        ))
    }
}

fn relay(stream: &Stream, left: Vec<u8>, pending: &Mutex<Option<Vec<Value>>>) {
    let lines = BufReader::new(io::Cursor::new(left).chain(stream)).lines();
    for line in lines {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(id) = v.get("id")
            && let Some(list) = pending.lock().unwrap_or_else(|e| e.into_inner()).as_mut()
        {
            list.retain(|x| x != id);
        }
        if to_browser(&v).is_err() {
            break;
        }
    }
    let waiting = pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .unwrap_or_default();
    for id in waiting {
        let _ = to_browser(&rpc_error(id, "Patchouli との接続が切れました".into()));
    }
}

/// ブラウザの拡張機能と、パイプのあいだを取り持つ。拡張機能は最初に hello で名前と権限を名乗れる。
/// アプリからの知らせ（トーストの再試行など）も、そのままブラウザへ渡す。
fn native(extension: &str) -> ExitCode {
    let mut input = io::stdin().lock();
    let mut bridge: Option<Bridge> = None;
    let mut hello =
        json!({ "client": "extension", "extension": extension, "permissions": PERMISSIONS });
    while let Ok(Some(msg)) = read_frame(&mut input) {
        let mut req: Value = match serde_json::from_slice(&msg) {
            Ok(v) => v,
            Err(e) => {
                let _ = to_browser(&rpc_error(Value::Null, e.to_string()));
                continue;
            }
        };
        let Some(id) = req.get("id").cloned() else {
            continue;
        };
        if req.get("method").and_then(Value::as_str) == Some(HELLO) {
            if let Some(p) = req.get("params") {
                for k in ["name", "permissions"] {
                    if let Some(v) = p.get(k) {
                        hello[k] = v.clone();
                    }
                }
            }
            let reply = match Bridge::open(hello.clone()) {
                Ok((b, r)) => {
                    bridge = Some(b);
                    json!({ "jsonrpc": "2.0", "id": id, "result": r })
                }
                Err(e) => rpc_error(id, e),
            };
            if to_browser(&reply).is_err() {
                break;
            }
            continue;
        }
        if !bridge.as_ref().is_some_and(Bridge::alive) {
            match Bridge::open(hello.clone()) {
                Ok((b, _)) => bridge = Some(b),
                Err(e) => {
                    if to_browser(&rpc_error(id, e)).is_err() {
                        break;
                    }
                    continue;
                }
            }
        }
        req["jsonrpc"] = json!("2.0");
        if let Some(err) = bridge.as_ref().and_then(|b| b.send(&req)) {
            bridge = None;
            if to_browser(&err).is_err() {
                break;
            }
        }
    }
    ExitCode::SUCCESS
}
