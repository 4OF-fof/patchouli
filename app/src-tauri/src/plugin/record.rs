use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::library::{read_json, write_json};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Local(PathBuf),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Default)]
pub struct Record {
    pub plugins: BTreeMap<String, Entry>,
    pub dev: BTreeSet<String>,
}

const KEY: &str = "plugins";
const DEV_KEY: &str = "devPlugins";

pub fn path(root: &Path) -> PathBuf {
    root.join(".patchouli").join("library.json")
}

impl Record {
    pub fn read(path: &Path) -> Result<Record, String> {
        let mut m = read_json(path)?.unwrap_or_default();
        let plugins = match m.remove(KEY) {
            Some(v) => serde_json::from_value(v).map_err(|e| format!("{}: {e}", path.display()))?,
            None => BTreeMap::new(),
        };
        let dev = match m.remove(DEV_KEY) {
            Some(v) => serde_json::from_value(v).map_err(|e| format!("{}: {e}", path.display()))?,
            None => BTreeSet::new(),
        };
        Ok(Record { plugins, dev })
    }

    /// library.json の plugins と devPlugins だけを書き換える。ほかのもの（ピン留めなど）は残す。
    pub fn write(&self, path: &Path) -> Result<(), String> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
        }
        let mut m = read_json(path)?.unwrap_or_default();
        m.insert(
            KEY.into(),
            serde_json::to_value(&self.plugins).map_err(|e| e.to_string())?,
        );
        if self.dev.is_empty() {
            m.remove(DEV_KEY);
        } else {
            m.insert(
                DEV_KEY.into(),
                serde_json::to_value(&self.dev).map_err(|e| e.to_string())?,
            );
        }
        write_json(path, &m)
    }
}

pub fn update(root: &Path, f: impl FnOnce(&mut Record)) -> Result<(), String> {
    let p = path(root);
    let mut r = Record::read(&p)?;
    f(&mut r);
    r.write(&p)
}

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

pub fn forget(root: &Path, id: &str) -> Result<(), String> {
    let p = stored_path(root, id);
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}
