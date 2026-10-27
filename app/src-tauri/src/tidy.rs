use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::plugin::Manifest;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Library,
    Thumbs,
    All,
}

#[derive(Debug, Clone, Serialize)]
pub struct Usage {
    pub library: u64,
    pub thumbs: u64,
}

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

fn library_files(cache: &Path, root: &Path) -> Vec<PathBuf> {
    let main = crate::cache::path_for(cache, root);
    let (Some(dir), Some(stem)) = (main.parent(), main.file_stem().and_then(|s| s.to_str())) else {
        return Vec::new();
    };
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    rd.filter_map(Result::ok)
        .filter(|e| e.file_name().to_str().is_some_and(|n| n.starts_with(stem)))
        .map(|e| e.path())
        .collect()
}

pub fn usage(cache: &Path, root: &Path) -> Usage {
    Usage {
        library: library_files(cache, root).iter().map(|p| size_of(p)).sum(),
        thumbs: size_of(&crate::thumb::dir_for(cache, root)),
    }
}

fn remove(p: &Path) -> Result<(), String> {
    let r = if p.is_dir() {
        fs::remove_dir_all(p)
    } else {
        fs::remove_file(p)
    };
    match r {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}

pub fn clear(cache: &Path, root: &Path, kind: Kind) -> Result<(), String> {
    if matches!(kind, Kind::Thumbs | Kind::All) {
        remove(&crate::thumb::dir_for(cache, root))?;
    }
    if matches!(kind, Kind::Library | Kind::All) {
        for p in library_files(cache, root) {
            remove(&p)?;
        }
    }
    Ok(())
}

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
