//! この端末だけの設定。アプリの設定フォルダの settings.json に置き、ライブラリには入れない。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

use crate::library::{read_json, write_json};

const FILE: &str = "settings.json";
const LIBRARY: &str = "library";
const RECENT: &str = "recent";
const DEVELOPER: &str = "developer";

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(FILE))
}

fn read(app: &AppHandle) -> Result<Map<String, Value>, String> {
    Ok(read_json(&path(app)?)?.unwrap_or_default())
}

fn write(app: &AppHandle, m: &Map<String, Value>) -> Result<(), String> {
    let p = path(app)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    write_json(&p, m)
}

/// 選んだライブラリの場所。
pub fn library(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    Ok(read(app)?
        .get(LIBRARY)
        .and_then(Value::as_str)
        .map(PathBuf::from))
}

pub fn set_library(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let mut m = read(app)?;
    m.insert(LIBRARY.into(), json!(dir.to_string_lossy()));
    write(app, &m)
}

/// 開いたことのあるライブラリ。plugins は、最後に開いたときに記録してあったプラグイン
/// （ライブラリを読めないときに、使っているプラグインを見分けるのに使う）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recent {
    pub path: PathBuf,
    /// 最後に開いた日時（UNIX ミリ秒）。
    pub opened: f64,
    #[serde(default)]
    pub plugins: Vec<String>,
}

/// 開いたことのあるライブラリ。最後に開いた順。
pub fn recent(app: &AppHandle) -> Result<Vec<Recent>, String> {
    Ok(read(app)?
        .get(RECENT)
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

fn set_recent(app: &AppHandle, list: &[Recent]) -> Result<(), String> {
    let mut m = read(app)?;
    m.insert(
        RECENT.into(),
        serde_json::to_value(list).map_err(|e| e.to_string())?,
    );
    write(app, &m)
}

/// root を開いたことを、いま記録してあるプラグインと一緒に残す。
pub fn remember(app: &AppHandle, root: &Path, plugins: Vec<String>) -> Result<(), String> {
    let opened = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64);
    let mut list = recent(app)?;
    list.retain(|r| r.path != root);
    list.insert(
        0,
        Recent {
            path: root.to_owned(),
            opened,
            plugins,
        },
    );
    set_recent(app, &list)
}

/// 履歴から外す。
pub fn forget(app: &AppHandle, root: &Path) -> Result<(), String> {
    let mut list = recent(app)?;
    list.retain(|r| r.path != root);
    set_recent(app, &list)
}

/// 開発者モード。plugin_dir は開発版を置くフォルダで、オフのあいだも残す。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Developer {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_dir: Option<PathBuf>,
}

pub fn developer(app: &AppHandle) -> Result<Developer, String> {
    Ok(read(app)?
        .get(DEVELOPER)
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

pub fn set_developer(app: &AppHandle, d: &Developer) -> Result<(), String> {
    let mut m = read(app)?;
    m.insert(
        DEVELOPER.into(),
        serde_json::to_value(d).map_err(|e| e.to_string())?,
    );
    write(app, &m)
}
