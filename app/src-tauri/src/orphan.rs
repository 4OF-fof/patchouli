use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::cache::Row;
use crate::library::{
    ID_KEY, NOTE_EXT, PROJECTS_DIR, STATE_DIR, TAG_INDEX, TAGS_DIR, check_name, listed, meta_path,
    read_json,
};

const EDGE: u64 = 8 * 1024;

/// 大きさと、先頭と末尾の一部のハッシュ。外で名前を変えた素材を見分けるのに使う。
pub fn print(path: &Path) -> Option<String> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut h = Sha256::new();
    let mut buf = vec![0; EDGE.min(len) as usize];
    f.read_exact(&mut buf).ok()?;
    h.update(&buf);
    if len > EDGE {
        f.seek(SeekFrom::Start(len.saturating_sub(EDGE).max(EDGE)))
            .ok()?;
        buf.clear();
        f.read_to_end(&mut buf).ok()?;
        h.update(&buf);
    }
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Some(format!("{len}:{hex}"))
}

/// 本体が見つからない .meta。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    pub meta: PathBuf,
    pub name: String,
    pub folder: Option<String>,
    pub project: bool,
    /// つなぎ直せる先。素材なら同じフォルダのタグもメモもない素材、プロジェクトなら .meta のないフォルダ
    pub candidates: Vec<String>,
}

struct Listing {
    files: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
    metas: Vec<PathBuf>,
}

fn listing(dir: &Path) -> Listing {
    let mut l = Listing {
        files: vec![],
        dirs: vec![],
        metas: vec![],
    };
    let Ok(rd) = fs::read_dir(dir) else {
        return l;
    };
    for e in rd.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name.ends_with(".meta") && !name.starts_with('.') {
            l.metas.push(path);
        } else if listed(&path) {
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                l.dirs.push(path);
            } else {
                l.files.push(path);
            }
        }
    }
    l.files.sort();
    l.dirs.sort();
    l.metas.sort();
    l
}

fn walk(dir: &Path, f: &mut impl FnMut(&Path, &Listing)) {
    let l = listing(dir);
    f(dir, &l);
    for d in &l.dirs {
        walk(d, f);
    }
}

fn owner_of(meta: &Path) -> PathBuf {
    let s = meta.as_os_str().to_string_lossy();
    PathBuf::from(s.strip_suffix(".meta").unwrap_or(&s))
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(NOTE_EXT))
}

fn id_of(meta: &Path) -> Option<String> {
    read_json(meta)
        .ok()??
        .get(ID_KEY)?
        .as_str()
        .map(str::to_owned)
}

/// id のほかに何も書いていない .meta（取り込んだときに書いたまま）。
fn bare(meta: &Path) -> bool {
    match read_json(meta) {
        Ok(Some(m)) => m.keys().all(|k| k == ID_KEY),
        Ok(None) => true,
        Err(_) => false,
    }
}

fn folder_of(root: &Path, dir: &Path) -> Option<String> {
    match dir.strip_prefix(root).ok()?.components().next()? {
        Component::Normal(n) => Some(n.to_string_lossy().into_owned()),
        _ => None,
    }
}

/// 写しで同じ中身だったと分かる素材が、同じフォルダに 1 つだけあれば、.meta をその名前に変える。
pub fn relink(root: &Path, known: &HashMap<PathBuf, Row>, problems: &mut Vec<String>) {
    let by_id: HashMap<&str, &Row> = known.values().map(|r| (r.item.id.as_str(), r)).collect();
    walk(root, &mut |_, l| {
        let lost: Vec<(&PathBuf, &str)> = l
            .metas
            .iter()
            .filter(|m| !owner_of(m).exists())
            .filter_map(|m| {
                let row = known.get(&owner_of(m)).or_else(|| {
                    let id = id_of(m)?;
                    by_id.get(id.as_str()).copied()
                })?;
                Some((m, row.item.print.as_deref()?))
            })
            .collect();
        if lost.is_empty() {
            return;
        }
        let fresh: Vec<(&PathBuf, String)> = l
            .files
            .iter()
            .filter(|f| !is_note(f) && !meta_path(f).exists())
            .filter_map(|f| Some((f, print(f)?)))
            .collect();
        for &(m, p) in &lost {
            let hits: Vec<_> = fresh.iter().filter(|(_, q)| q == p).collect();
            let rivals = lost.iter().filter(|(_, q)| *q == p).count();
            if let ([(to, _)], 1) = (hits.as_slice(), rivals)
                && let Err(e) = fs::rename(m, meta_path(to))
            {
                problems.push(format!("{}: {e}", m.display()));
            }
        }
    });
}

pub fn find(root: &Path, items: &HashSet<String>) -> Vec<Orphan> {
    let mut out = vec![];
    walk(root, &mut |dir, l| {
        for m in l.metas.iter().filter(|m| !owner_of(m).exists()) {
            let id = id_of(m);
            let project = dir == root
                && id.as_ref().is_none_or(|id| !items.contains(id))
                && (id.as_ref().is_some_and(|id| cards_dir(root, id).is_dir()) || bare(m));
            let candidates = if project {
                l.dirs
                    .iter()
                    .filter(|d| !meta_path(d).exists())
                    .map(|d| name_of(d))
                    .collect()
            } else {
                l.files
                    .iter()
                    .filter(|f| !is_note(f) && bare(&meta_path(f)))
                    .map(|f| name_of(f))
                    .collect()
            };
            out.push(Orphan {
                meta: m.clone(),
                name: name_of(&owner_of(m)),
                folder: folder_of(root, dir),
                project,
                candidates,
            });
        }
    });
    out
}

fn cards_dir(root: &Path, id: &str) -> PathBuf {
    root.join(STATE_DIR).join(PROJECTS_DIR).join(id)
}

pub fn relink_to(root: &Path, o: &Orphan, to: &str) -> Result<(), String> {
    check_name(to)?;
    if !o.candidates.iter().any(|c| c == to) {
        return Err(format!("「{to}」には再リンクできません"));
    }
    let target = o.meta.parent().unwrap_or(root).join(to);
    let meta = meta_path(&target);
    if !o.project && meta.exists() {
        trash::delete(&meta).map_err(|e| format!("{}: {e}", meta.display()))?;
    }
    fs::rename(&o.meta, &meta).map_err(|e| format!("{}: {e}", o.meta.display()))
}

pub fn discard(root: &Path, o: &Orphan) -> Result<(), String> {
    let mut files = vec![o.meta.clone()];
    if o.project
        && let Some(id) = id_of(&o.meta).filter(|id| check_name(id).is_ok())
        && cards_dir(root, &id).is_dir()
    {
        files.push(cards_dir(root, &id));
    }
    trash::delete_all(&files).map_err(|e| format!("{}: {e}", o.meta.display()))
}

/// どの .meta からも、タグの一覧からも指されていないカードのフォルダを、ごみ箱に移す。
pub fn sweep(root: &Path, problems: &mut Vec<String>) {
    let mut projects = HashSet::new();
    for m in listing(root).metas {
        match read_json(&m) {
            Ok(m) => projects.extend(m.and_then(|m| m.get(ID_KEY)?.as_str().map(str::to_owned))),
            Err(_) => return,
        }
    }
    let tags_dir = root.join(STATE_DIR).join(TAGS_DIR);
    let tags: HashSet<String> = match read_json(&tags_dir.join(TAG_INDEX)) {
        Ok(m) => m
            .unwrap_or_default()
            .values()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        Err(_) => return,
    };
    for (dir, keep) in [
        (root.join(STATE_DIR).join(PROJECTS_DIR), &projects),
        (tags_dir, &tags),
    ] {
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        let gone: Vec<PathBuf> = rd
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter(|e| !keep.contains(&*e.file_name().to_string_lossy()))
            .map(|e| e.path())
            .collect();
        if !gone.is_empty()
            && let Err(e) = trash::delete_all(&gone)
        {
            problems.push(format!("{}: {e}", dir.display()));
        }
    }
}
