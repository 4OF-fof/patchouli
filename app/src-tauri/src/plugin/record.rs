//! ライブラリに残すプラグインの記録（`.patchouli/plugins.json`）。使うプラグインの取得先と版、設定の値を持つ。
//! ここにないプラグインは、アプリに入っていても使わない。

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
    /// 入れた版。組み込みのプラグインにはない。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// 組み込みのプラグインにはない。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub settings: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Record {
    #[serde(default)]
    pub plugins: BTreeMap<String, Entry>,
}

pub fn path(root: &Path) -> PathBuf {
    root.join(".patchouli").join("plugins.json")
}

impl Record {
    pub fn read(path: &Path) -> Result<Record, String> {
        match read_json(path)? {
            Some(m) => serde_json::from_value(Value::Object(m))
                .map_err(|e| format!("{}: {e}", path.display())),
            None => Ok(Record::default()),
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

/// root のライブラリの記録を読んで f で変え、書き戻す。
pub fn update(root: &Path, f: impl FnOnce(&mut Record)) -> Result<(), String> {
    let p = path(root);
    let mut r = Record::read(&p)?;
    f(&mut r);
    r.write(&p)
}
