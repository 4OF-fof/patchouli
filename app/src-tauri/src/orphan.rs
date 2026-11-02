use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::cache::Row;
use crate::library::{
    ID_KEY, NOTE_EXT, PRINT_KEY, PROJECT_TYPE, PROJECTS_DIR, STATE_DIR, TAG_INDEX, TAGS_DIR,
    TYPE_KEY, check_name, listed_entry, meta_path, name_of, read_json, write_json,
};
use crate::note;

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

/// 直下の項目とグループの ID を並べ替えてまとめたハッシュ。外で名前を変えたグループを見分けるのに使う。
pub fn group_print(mut ids: Vec<String>) -> String {
    ids.sort();
    let mut h = Sha256::new();
    for id in &ids {
        h.update(id.as_bytes());
        h.update(b"\n");
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn child_ids(dir: &Path) -> Vec<String> {
    let l = listing(dir);
    l.files
        .iter()
        .filter_map(|f| {
            if is_note(f) {
                let text = fs::read_to_string(f).ok()?;
                let v = note::front_values(note::split(&text).front).ok()?;
                note::str_of(&v, ID_KEY)
            } else {
                id_of(&meta_path(f))
            }
        })
        .chain(l.dirs.iter().filter_map(|d| id_of(&meta_path(d))))
        .collect()
}

/// フォルダの中身を読み直して、.meta の照合用の値を書き直す。.meta のないフォルダは、次に読むときに書く。
pub fn reprint(dir: &Path) -> Result<(), String> {
    let meta = meta_path(dir);
    let Some(mut m) = read_json(&meta)? else {
        return Ok(());
    };
    let print = json!(group_print(child_ids(dir)));
    if m.get(PRINT_KEY) == Some(&print) {
        return Ok(());
    }
    m.insert(PRINT_KEY.into(), print);
    write_json(&meta, &m)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OrphanKind {
    Asset,
    Project,
    Group,
}

/// 本体が見つからない .meta。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    pub meta: PathBuf,
    pub name: String,
    /// ある場所。ライブラリからのフォルダの並びを / でつないだもの
    pub place: Option<String>,
    pub kind: OrphanKind,
    /// つなぎ直せる先。素材なら同じフォルダのタグもメモもない素材、グループなら種類のないグループ
    pub candidates: Vec<String>,
}

struct Listing {
    files: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
    metas: Vec<PathBuf>,
    /// フォルダにあるものすべての名前
    names: HashSet<OsString>,
}

fn listing(dir: &Path) -> Listing {
    let mut l = Listing {
        files: vec![],
        dirs: vec![],
        metas: vec![],
        names: HashSet::new(),
    };
    let Ok(rd) = fs::read_dir(dir) else {
        return l;
    };
    for e in rd.flatten() {
        let path = e.path();
        l.names.insert(e.file_name());
        let name = e.file_name().to_string_lossy().into_owned();
        if name.ends_with(".meta") && !name.starts_with('.') {
            l.metas.push(path);
        } else if listed_entry(&e) {
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

/// .meta の持ち主があるか。まず読んだフォルダの名前から探し、ないときだけ確かめる（大文字と小文字だけ違うものなど）
fn owned(l: &Listing, meta: &Path) -> bool {
    let owner = owner_of(meta);
    owner.file_name().is_some_and(|n| l.names.contains(n)) || owner.exists()
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

/// keys のほかに何も書いていない .meta（取り込んだときや、見つけたときに書いたまま）。
fn bare(meta: &Path, keys: &[&str]) -> bool {
    match read_json(meta) {
        Ok(Some(m)) => m.keys().all(|k| keys.contains(&k.as_str())),
        Ok(None) => true,
        Err(_) => false,
    }
}

fn place_of(root: &Path, dir: &Path) -> Option<String> {
    let parts: Vec<String> = dir
        .strip_prefix(root)
        .ok()?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// 照合用の値が同じものが、どちらにも 1 つだけあれば、.meta をその名前に変える。
fn rename_unique(
    lost: &[(&PathBuf, String)],
    fresh: &[(&PathBuf, String)],
    problems: &mut Vec<String>,
) {
    for (m, p) in lost {
        let hits: Vec<_> = fresh.iter().filter(|(_, q)| q == p).collect();
        let rivals = lost.iter().filter(|(_, q)| q == p).count();
        if let ([(to, _)], 1) = (hits.as_slice(), rivals)
            && let Err(e) = fs::rename(m, meta_path(to))
        {
            problems.push(format!("{}: {e}", m.display()));
        }
    }
}

/// 写しで同じ中身だったと分かる素材と、直下の ID が同じだと分かるグループが、
/// 同じフォルダに 1 つだけあれば、.meta をその名前に変える。
pub fn relink(root: &Path, known: &HashMap<PathBuf, Row>, problems: &mut Vec<String>) {
    let by_id: HashMap<&str, &Row> = known.values().map(|r| (r.item.id.as_str(), r)).collect();
    let empty = group_print(vec![]);
    walk(root, &mut |_, l| {
        let lost_dirs: Vec<(&PathBuf, String)> = l
            .metas
            .iter()
            .filter(|m| !owned(l, m))
            .filter_map(|m| {
                let p = read_json(m).ok()??.get(PRINT_KEY)?.as_str()?.to_owned();
                (p != empty).then_some((m, p))
            })
            .collect();
        if !lost_dirs.is_empty() {
            let fresh: Vec<(&PathBuf, String)> = l
                .dirs
                .iter()
                .filter(|d| !meta_path(d).exists())
                .map(|d| (d, group_print(child_ids(d))))
                .collect();
            rename_unique(&lost_dirs, &fresh, problems);
        }
        let lost: Vec<(&PathBuf, String)> = l
            .metas
            .iter()
            .filter(|m| !owned(l, m))
            .filter_map(|m| {
                let row = known.get(&owner_of(m)).or_else(|| {
                    let id = id_of(m)?;
                    by_id.get(id.as_str()).copied()
                })?;
                Some((m, row.item.print.clone()?))
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
        rename_unique(&lost, &fresh, problems);
    });
}

pub fn find(root: &Path) -> Vec<Orphan> {
    let mut out = vec![];
    walk(root, &mut |dir, l| {
        for m in l.metas.iter().filter(|m| !owned(l, m)) {
            let map = read_json(m).ok().flatten().unwrap_or_default();
            let kind = if !map.contains_key(PRINT_KEY) && !map.contains_key(TYPE_KEY) {
                OrphanKind::Asset
            } else if dir == root && map.get(TYPE_KEY).and_then(Value::as_str) == Some(PROJECT_TYPE)
            {
                OrphanKind::Project
            } else {
                OrphanKind::Group
            };
            let candidates = if kind == OrphanKind::Asset {
                l.files
                    .iter()
                    .filter(|f| !is_note(f) && bare(&meta_path(f), &[ID_KEY]))
                    .map(|f| name_of(f))
                    .collect()
            } else {
                l.dirs
                    .iter()
                    .filter(|d| bare(&meta_path(d), &[ID_KEY, PRINT_KEY]))
                    .map(|d| name_of(d))
                    .collect()
            };
            out.push(Orphan {
                meta: m.clone(),
                name: name_of(&owner_of(m)),
                place: place_of(root, dir),
                kind,
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
    if meta.exists() {
        trash::delete(&meta).map_err(|e| format!("{}: {e}", meta.display()))?;
    }
    fs::rename(&o.meta, &meta).map_err(|e| format!("{}: {e}", o.meta.display()))
}

pub fn discard(root: &Path, o: &Orphan) -> Result<(), String> {
    let mut files = vec![o.meta.clone()];
    if o.kind == OrphanKind::Project
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
