//! キャッシュと、どのライブラリでも使っていないプラグインの片付け。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::plugin::Manifest;

/// キャッシュの置き場（アプリのキャッシュフォルダの下）。
const LIBRARY: &str = "library";
const THUMBS: &str = "thumbs";

/// 消すキャッシュの種類。library はライブラリの写し。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Library,
    Thumbs,
    All,
}

/// キャッシュの使っている量（バイト）。
#[derive(Debug, Clone, Serialize)]
pub struct Usage {
    pub library: u64,
    pub thumbs: u64,
}

/// どのライブラリでも使っていないプラグイン。
#[derive(Debug, Clone, Serialize)]
pub struct Unused {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub bytes: u64,
}

fn size_of(path: &Path) -> u64 {
    let Ok(m) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !m.is_dir() {
        return m.len();
    }
    fs::read_dir(path).map_or(0, |rd| {
        rd.filter_map(Result::ok).map(|e| size_of(&e.path())).sum()
    })
}

pub fn usage(cache: &Path) -> Usage {
    Usage {
        library: size_of(&cache.join(LIBRARY)),
        thumbs: size_of(&cache.join(THUMBS)),
    }
}

/// kind のキャッシュをすべてのライブラリの分消す。開いているライブラリの写しは、閉じてから呼ぶ。
pub fn clear(cache: &Path, kind: Kind) -> Result<(), String> {
    let dirs: &[&str] = match kind {
        Kind::Library => &[LIBRARY],
        Kind::Thumbs => &[THUMBS],
        Kind::All => &[LIBRARY, THUMBS],
    };
    for d in dirs {
        let p = cache.join(d);
        match fs::remove_dir_all(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("{}: {e}", p.display())),
        }
    }
    Ok(())
}

/// プラグインの置き場 dir にあるもののうち、used にないもの。作業中のもの（「.」で始まる）は除く。
pub fn unused(dir: &Path, used: &HashSet<String>) -> Vec<(Unused, PathBuf)> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(Unused, PathBuf)> = rd
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let id = e.file_name().into_string().ok()?;
            if id.starts_with('.') || used.contains(&id) {
                return None;
            }
            let path = e.path();
            let m = Manifest::read(&path).ok();
            Some((
                Unused {
                    name: m.as_ref().map_or_else(|| id.clone(), |m| m.name.clone()),
                    version: m.map(|m| m.version),
                    bytes: size_of(&path),
                    id,
                },
                path,
            ))
        })
        .collect();
    out.sort_by(|a, b| a.0.name.cmp(&b.0.name));
    out
}
