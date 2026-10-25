//! この端末だけの設定。アプリの設定フォルダの settings.json に置き、ライブラリには入れない。

use std::path::PathBuf;

use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

use crate::library::{read_json, write_json};

const FILE: &str = "settings.json";
const LIBRARY: &str = "library";

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

/// 選んだライブラリの場所。
pub fn library(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    Ok(read(app)?
        .get(LIBRARY)
        .and_then(Value::as_str)
        .map(PathBuf::from))
}

pub fn set_library(app: &AppHandle, dir: &std::path::Path) -> Result<(), String> {
    let p = path(app)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    let mut m = read(app)?;
    m.insert(LIBRARY.into(), json!(dir.to_string_lossy()));
    write_json(&p, &m)
}
