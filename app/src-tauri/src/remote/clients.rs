//! つないできた口ごとの権限。初めての口には、画面で許可を聞く。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError, mpsc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::remote::proto::PERMISSIONS;
use crate::shell::settings::{self, RemoteClient};
use crate::shell::{tray, web};

const ASK_WAIT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    pub id: u64,
    pub key: String,
    pub name: String,
    pub permissions: Vec<String>,
}

type Answer = Option<Vec<String>>;

static NEXT: AtomicU64 = AtomicU64::new(1);
static ASKS: Mutex<Vec<(Ask, mpsc::Sender<Answer>)>> = Mutex::new(Vec::new());

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

pub fn known_permissions(list: impl IntoIterator<Item = String>) -> Vec<String> {
    let list: Vec<String> = list.into_iter().collect();
    PERMISSIONS
        .iter()
        .filter(|p| list.iter().any(|x| x == *p))
        .map(|p| (*p).to_owned())
        .collect()
}

/// key の口に許した権限。初めての口なら、画面で聞いてから決める。
pub fn grant(
    app: &AppHandle,
    key: &str,
    name: &str,
    wanted: Vec<String>,
) -> Result<Vec<String>, String> {
    let known = settings::update_remote(app, |r| {
        let c = r.clients.iter_mut().find(|c| c.key == key);
        Ok(c.map(|c| {
            c.last = now();
            c.clone()
        }))
    })?;
    if let Some(c) = known {
        return if c.allowed {
            Ok(c.permissions)
        } else {
            Err(format!("「{}」からの接続は拒否されています", c.name))
        };
    }
    let ask = Ask {
        id: NEXT.fetch_add(1, Ordering::Relaxed),
        key: key.to_owned(),
        name: name.to_owned(),
        permissions: known_permissions(wanted),
    };
    let (tx, rx) = mpsc::channel();
    lock().push((ask.clone(), tx));
    if let Err(e) = app.emit_to(web::MAIN, "remote-ask", &ask) {
        log::warn!("接続の許可を画面で聞けない: {e}");
    }
    tray::show_main(app);
    let answer = rx.recv_timeout(ASK_WAIT);
    lock().retain(|(a, _)| a.id != ask.id);
    let _ = app.emit_to(web::MAIN, "remote-ask-closed", ask.id);
    let Ok(answer) = answer else {
        return Err("接続の許可を待つあいだに時間切れになりました".into());
    };
    let allowed = answer.is_some();
    let permissions = answer.map(known_permissions).unwrap_or_default();
    settings::update_remote(app, |r| {
        r.clients.retain(|c| c.key != key);
        r.clients.push(RemoteClient {
            key: key.to_owned(),
            name: name.to_owned(),
            allowed,
            permissions: permissions.clone(),
            last: now(),
        });
        Ok(())
    })?;
    if allowed {
        Ok(permissions)
    } else {
        Err(format!("「{name}」からの接続は拒否されました"))
    }
}

fn lock() -> std::sync::MutexGuard<'static, Vec<(Ask, mpsc::Sender<Answer>)>> {
    ASKS.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn pending() -> Vec<Ask> {
    lock().iter().map(|(a, _)| a.clone()).collect()
}

pub fn answer(id: u64, permissions: Answer) {
    if let Some((_, tx)) = lock().iter().find(|(a, _)| a.id == id) {
        let _ = tx.send(permissions);
    }
}

/// 許した権限を、いまつないでいる口にも効かせるため、要求ごとに読み直す。
pub fn current(app: &AppHandle, key: &str) -> Result<Vec<String>, String> {
    let r = settings::remote(app)?;
    match r.clients.into_iter().find(|c| c.key == key) {
        Some(c) if c.allowed => Ok(c.permissions),
        Some(c) => Err(format!("「{}」からの接続は拒否されています", c.name)),
        None => Err("接続の許可が取り消されました".into()),
    }
}
