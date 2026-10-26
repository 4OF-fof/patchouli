//! ライブラリに残すプラグインの記録。
//!
//! - `.patchouli/library.json` の `plugins`: 使うプラグインの版と取得先、取得元の検証値。
//!   ここにないプラグインは、アプリに入っていても使わない
//! - `.patchouli/plugins/<id>.json`: 設定の値（`settings`）と、プラグインが自分で読み書きする値（`data`）

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::library::{read_json, write_json};

/// プラグインの取得先。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// 手元の zip。
    Local(PathBuf),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// 入れた版。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    /// 取得元の検証値（zip は「sha256:<16 進>」）。取り直したときに同じものかを確かめる。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Record {
    pub plugins: BTreeMap<String, Entry>,
}

const KEY: &str = "plugins";

pub fn path(root: &Path) -> PathBuf {
    root.join(".patchouli").join("library.json")
}

impl Record {
    pub fn read(path: &Path) -> Result<Record, String> {
        let plugins = match read_json(path)?.and_then(|mut m| m.remove(KEY)) {
            Some(v) => serde_json::from_value(v).map_err(|e| format!("{}: {e}", path.display()))?,
            None => BTreeMap::new(),
        };
        Ok(Record { plugins })
    }

    /// library.json の plugins だけを書き換える。ほかのもの（ピン留めなど）は残す。
    pub fn write(&self, path: &Path) -> Result<(), String> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
        }
        let mut m = read_json(path)?.unwrap_or_default();
        m.insert(
            KEY.into(),
            serde_json::to_value(&self.plugins).map_err(|e| e.to_string())?,
        );
        write_json(path, &m)
    }
}

/// root のライブラリの記録を読んで f で変え、書き戻す。
pub fn update(root: &Path, f: impl FnOnce(&mut Record)) -> Result<(), String> {
    let p = path(root);
    let mut r = Record::read(&p)?;
    f(&mut r);
    r.write(&p)
}

/// プラグインごとに残す値。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Stored {
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub settings: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub data: Map<String, Value>,
}

pub fn stored_path(root: &Path, id: &str) -> PathBuf {
    root.join(".patchouli")
        .join("plugins")
        .join(format!("{id}.json"))
}

impl Stored {
    pub fn read(path: &Path) -> Result<Stored, String> {
        match read_json(path)? {
            Some(m) => serde_json::from_value(Value::Object(m))
                .map_err(|e| format!("{}: {e}", path.display())),
            None => Ok(Stored::default()),
        }
    }

    pub fn write(&self, path: &Path) -> Result<(), String> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
        }
        let Value::Object(m) = serde_json::to_value(self).map_err(|e| e.to_string())? else {
            unreachable!()
        };
        write_json(path, &m)
    }
}

/// root のライブラリから、プラグイン id の値を消す。
pub fn forget(root: &Path, id: &str) -> Result<(), String> {
    let p = stored_path(root, id);
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}
