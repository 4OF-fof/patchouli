use std::collections::HashMap;
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
const AUTO_TAG: &str = "autoTag";
const TAG_SUGGEST: &str = "tagSuggest";
const CONTENT_SEARCH: &str = "contentSearch";
const DEVICE: &str = "device";
const APP: &str = "app";

/// タグの候補の扱い。auto は選択済みの候補をそのまま付け、confirm は分類の確認に出す。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TagSuggest {
    Auto,
    #[default]
    Confirm,
    Off,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recent {
    pub path: PathBuf,
    pub opened: f64,
    #[serde(default)]
    pub plugins: Vec<String>,
}

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

pub fn forget(app: &AppHandle, root: &Path) -> Result<(), String> {
    let mut list = recent(app)?;
    list.retain(|r| r.path != root);
    set_recent(app, &list)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Developer {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub plugin_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub repos: Vec<PathBuf>,
}

pub fn auto_tag(app: &AppHandle) -> Result<bool, String> {
    Ok(read(app)?
        .get(AUTO_TAG)
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

/// この端末の ID。端末ごとに分けて同期するファイルの名前に使う。初めて使うときに作る。
pub fn device(app: &AppHandle) -> Result<String, String> {
    let mut m = read(app)?;
    if let Some(id) = m.get(DEVICE).and_then(Value::as_str) {
        return Ok(id.to_owned());
    }
    let id = uuid::Uuid::new_v4().to_string();
    m.insert(DEVICE.into(), json!(id));
    write(app, &m)?;
    Ok(id)
}

pub fn set_auto_tag(app: &AppHandle, on: bool) -> Result<(), String> {
    let mut m = read(app)?;
    m.insert(AUTO_TAG.into(), json!(on));
    write(app, &m)
}

pub fn tag_suggest(app: &AppHandle) -> Result<TagSuggest, String> {
    Ok(read(app)?
        .get(TAG_SUGGEST)
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

pub fn set_tag_suggest(app: &AppHandle, s: TagSuggest) -> Result<(), String> {
    let mut m = read(app)?;
    m.insert(
        TAG_SUGGEST.into(),
        serde_json::to_value(s).map_err(|e| e.to_string())?,
    );
    write(app, &m)
}

pub fn content_search(app: &AppHandle) -> Result<bool, String> {
    Ok(read(app)?
        .get(CONTENT_SEARCH)
        .and_then(Value::as_bool)
        .unwrap_or(true))
}

pub fn set_content_search(app: &AppHandle, on: bool) -> Result<(), String> {
    let mut m = read(app)?;
    m.insert(CONTENT_SEARCH.into(), json!(on));
    write(app, &m)
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    #[default]
    Copy,
    Move,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThumbSize {
    #[default]
    Standard,
    Large,
}

/// 本体の設定。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub import_mode: ImportMode,
    #[serde(default)]
    pub thumb_size: ThumbSize,
    /// 外部ツールの名前 → 指定した場所
    #[serde(default)]
    pub command_paths: HashMap<String, PathBuf>,
}

pub fn app_settings(app: &AppHandle) -> Result<AppSettings, String> {
    Ok(read(app)?
        .get(APP)
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

pub fn set_app_settings(app: &AppHandle, s: &AppSettings) -> Result<(), String> {
    let mut m = read(app)?;
    m.insert(
        APP.into(),
        serde_json::to_value(s).map_err(|e| e.to_string())?,
    );
    write(app, &m)
}
