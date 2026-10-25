//! ライブラリのフォルダの読み書き。
//!
//! - 直下のフォルダがプロジェクト。フォルダの属性は同じ階層の `<名前>.meta`（JSON）に置く
//! - 素材の属性は `<ファイル名>.meta`（JSON）、ノートの属性は frontmatter に置く
//! - ピン留めとタグの表紙は `.patchouli/library.json` に置く
//! - `.` で始まるものは読まない（ほかのツールの設定や、書き込み途中のファイル）
//!
//! 読むときは何も書かない。ID のない素材やノートには仮の ID を渡し、最初に保存するときに書く。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::note::{self, Block};

pub const ID_KEY: &str = "patchouli-id";
const STATE_DIR: &str = ".patchouli";
const STATE_FILE: &str = "library.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Video,
    Audio,
    Note,
}

fn kind_of(ext: &str) -> Option<Kind> {
    Some(match ext {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp" => Kind::Image,
        "mp4" | "webm" | "mov" | "m4v" => Kind::Video,
        "m4a" | "mp3" | "wav" | "ogg" | "flac" | "opus" => Kind::Audio,
        "md" => Kind::Note,
        _ => return None,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredItem {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    pub ext: String,
    pub folder: Option<String>,
    pub tags: Vec<String>,
    pub rating: u8,
    pub memo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<Block>>,
    /// 更新日時（UNIX ミリ秒）。
    pub mtime: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub file: PathBuf,
    /// サムネイルの場所。まだできていなければない。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub name: String,
    pub cover: Value,
    /// フォルダと中身のうち、いちばん新しい更新日時（UNIX ミリ秒）。
    pub mtime: f64,
}

/// ライブラリ全体にかかわる状態。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryState {
    pub pins: Vec<String>,
    pub pinned_projects: Vec<String>,
    pub pinned_tags: Vec<String>,
    pub tag_covers: Map<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub root: PathBuf,
    pub items: Vec<StoredItem>,
    pub projects: Vec<StoredProject>,
    pub state: LibraryState,
    /// 読めなかったもの（「パス: 理由」）。
    pub problems: Vec<String>,
}

/// 保存する属性。書いたものだけを変える。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemPatch {
    pub tags: Option<Vec<String>>,
    pub aliases: Option<Vec<String>>,
    pub rating: Option<u8>,
    pub memo: Option<String>,
    pub blocks: Option<Vec<Block>>,
}

struct Entry {
    path: PathBuf,
    note: bool,
    /// ID がファイルに書いてある。
    saved: bool,
}

pub struct Library {
    root: PathBuf,
    entries: HashMap<String, Entry>,
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn mtime_of(path: &Path) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_millis() as f64)
}

pub(crate) fn read_json(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    match fs::read_to_string(path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(Value::Object(m)) => Ok(Some(m)),
            Ok(_) => Err("中身が JSON のオブジェクトでない".into()),
            Err(e) => Err(format!("JSON を読めない: {e}")),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 同じフォルダに一時ファイルを書いてから置き換える。同期ソフトに書きかけを拾わせない。
fn write_file(path: &Path, text: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("ファイル名がない")?;
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

pub(crate) fn write_json(path: &Path, v: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())? + "\n";
    write_file(path, &text)
}

fn meta_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".meta");
    PathBuf::from(s)
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// ファイルやフォルダの名前に使えるか。
pub fn check_name(name: &str) -> Result<(), String> {
    let bad = name.trim().is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c));
    if bad {
        Err(format!("「{name}」は名前に使えない"))
    } else {
        Ok(())
    }
}

impl Library {
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn open(root: &Path) -> Result<(Library, Opened), String> {
        let root = fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
        let root = dunce(root);
        let mut lib = Library {
            root: root.clone(),
            entries: HashMap::new(),
        };
        let mut items = Vec::new();
        let mut projects = Vec::new();
        let mut problems = Vec::new();

        for (path, is_dir) in list_dir(&root, &mut problems) {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_owned();
            if !is_dir {
                lib.read_item(&path, None, &mut items, &mut problems);
                continue;
            }
            let meta = meta_path(&path);
            let cover = match read_json(&meta) {
                Ok(m) => m
                    .and_then(|mut m| m.remove("cover"))
                    .unwrap_or_else(|| json!([])),
                Err(e) => {
                    problems.push(format!("{}: {e}", meta.display()));
                    json!([])
                }
            };
            let from = items.len();
            lib.read_dir(&path, &name, &mut items, &mut problems);
            let mtime = items[from..]
                .iter()
                .map(|i| i.mtime)
                .fold(mtime_of(&path).max(mtime_of(&meta)), f64::max);
            projects.push(StoredProject { name, cover, mtime });
        }

        let state_path = root.join(STATE_DIR).join(STATE_FILE);
        let state = match read_json(&state_path) {
            Ok(Some(m)) => serde_json::from_value(Value::Object(m)).unwrap_or_else(|e| {
                problems.push(format!("{}: {e}", state_path.display()));
                LibraryState::default()
            }),
            Ok(None) => LibraryState::default(),
            Err(e) => {
                problems.push(format!("{}: {e}", state_path.display()));
                LibraryState::default()
            }
        };
        Ok((
            lib,
            Opened {
                root,
                items,
                projects,
                state,
                problems,
            },
        ))
    }

    fn read_dir(
        &mut self,
        dir: &Path,
        project: &str,
        items: &mut Vec<StoredItem>,
        problems: &mut Vec<String>,
    ) {
        for (path, is_dir) in list_dir(dir, problems) {
            if is_dir {
                self.read_dir(&path, project, items, problems);
            } else {
                self.read_item(&path, Some(project), items, problems);
            }
        }
    }

    fn read_item(
        &mut self,
        path: &Path,
        folder: Option<&str>,
        items: &mut Vec<StoredItem>,
        problems: &mut Vec<String>,
    ) {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let Some(kind) = kind_of(&ext) else { return };
        let name = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_owned();
        let read = if kind == Kind::Note {
            read_note(path)
        } else {
            read_asset(path)
        };
        let mut r = match read {
            Ok(r) => r,
            Err(e) => {
                problems.push(format!("{}: {e}", path.display()));
                return;
            }
        };
        // コピーしたファイルは ID が重なる。あとから見つけたほうに新しい ID を渡す
        let saved = matches!(&r.id, Some(id) if !self.entries.contains_key(id));
        let id = if saved {
            r.id.take().unwrap_or_default()
        } else {
            new_id()
        };
        let (width, height) = match kind {
            Kind::Image => imagesize::size(path).map_or((None, None), |s| {
                (Some(s.width as u32), Some(s.height as u32))
            }),
            _ => (None, None),
        };
        self.entries.insert(
            id.clone(),
            Entry {
                path: path.to_owned(),
                note: kind == Kind::Note,
                saved,
            },
        );
        items.push(StoredItem {
            id,
            kind,
            name,
            ext,
            folder: folder.map(str::to_owned),
            tags: r.tags,
            rating: r.rating,
            memo: r.memo,
            aliases: r.aliases,
            blocks: r.blocks,
            mtime: mtime_of(path),
            width,
            height,
            file: path.to_owned(),
            thumb: None,
        });
    }

    fn entry(&self, id: &str) -> Result<&Entry, String> {
        self.entries
            .get(id)
            .ok_or_else(|| format!("ID {id} の項目がない"))
    }

    pub fn save_item(&mut self, id: &str, patch: &ItemPatch) -> Result<(), String> {
        let e = self.entry(id)?;
        if e.note {
            save_note(&e.path, id, patch)?
        } else {
            save_asset(&e.path, id, patch)?
        }
        if let Some(e) = self.entries.get_mut(id) {
            e.saved = true;
        }
        Ok(())
    }

    /// ID がまだファイルにないときだけ書く。
    fn ensure_saved(&mut self, id: &str) -> Result<(), String> {
        match self.entries.get(id) {
            Some(e) if !e.saved => self.save_item(id, &ItemPatch::default()),
            _ => Ok(()),
        }
    }

    pub fn save_state(&mut self, state: &LibraryState) -> Result<(), String> {
        for id in &state.pins {
            self.ensure_saved(id)?;
        }
        let dir = self.root.join(STATE_DIR);
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let Value::Object(m) = serde_json::to_value(state).map_err(|e| e.to_string())? else {
            unreachable!()
        };
        write_json(&dir.join(STATE_FILE), &m)
    }

    fn project_dir(&self, name: &str) -> Result<PathBuf, String> {
        check_name(name)?;
        Ok(self.root.join(name))
    }

    pub fn create_note(&mut self, name: &str, folder: Option<&str>) -> Result<StoredItem, String> {
        check_name(name)?;
        let dir = match folder {
            Some(f) => self.project_dir(f)?,
            None => self.root.clone(),
        };
        let path = dir.join(format!("{name}.md"));
        if path.exists() {
            return Err(format!("{} はもうある", path.display()));
        }
        let id = new_id();
        let mut front = String::new();
        for (k, v) in [
            (ID_KEY, json!(id)),
            ("tags", json!([])),
            ("aliases", json!([])),
        ] {
            front = note::set_key(&front, k, &v);
        }
        write_file(&path, &note::join(&front, "\n"))?;
        self.entries.insert(
            id.clone(),
            Entry {
                path: path.clone(),
                note: true,
                saved: true,
            },
        );
        Ok(StoredItem {
            id,
            kind: Kind::Note,
            name: name.to_owned(),
            ext: "md".into(),
            folder: folder.map(str::to_owned),
            tags: vec![],
            rating: 0,
            memo: String::new(),
            aliases: Some(vec![]),
            blocks: Some(vec![]),
            mtime: mtime_of(&path),
            width: None,
            height: None,
            file: path,
            thumb: None,
        })
    }

    pub fn create_project(&mut self, name: &str) -> Result<StoredProject, String> {
        let dir = self.project_dir(name)?;
        let meta = meta_path(&dir);
        if dir.exists() || meta.exists() {
            return Err(format!("プロジェクト「{name}」はもうある"));
        }
        fs::create_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let mut m = Map::new();
        m.insert(ID_KEY.into(), json!(new_id()));
        m.insert("cover".into(), json!([]));
        write_json(&meta, &m)?;
        Ok(StoredProject {
            name: name.to_owned(),
            cover: json!([]),
            mtime: mtime_of(&meta),
        })
    }

    pub fn save_project(&mut self, name: &str, cover: Value) -> Result<(), String> {
        let dir = self.project_dir(name)?;
        if !dir.is_dir() {
            return Err(format!("プロジェクト「{name}」がない"));
        }
        let meta = meta_path(&dir);
        let mut m = read_json(&meta)?.unwrap_or_default();
        if !m.contains_key(ID_KEY) {
            m.insert(ID_KEY.into(), json!(new_id()));
        }
        m.insert("cover".into(), cover);
        write_json(&meta, &m)
    }
}

/// Windows の canonicalize が付ける `\\?\` を外す。
fn dunce(p: PathBuf) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(s) if !s.starts_with("UNC\\") => PathBuf::from(s),
        _ => p,
    }
}

/// フォルダの中身を名前順に。`.` で始まるものと `.meta` は除く。
fn list_dir(dir: &Path, problems: &mut Vec<String>) -> Vec<(PathBuf, bool)> {
    let rd = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            problems.push(format!("{}: {e}", dir.display()));
            return vec![];
        }
    };
    let mut out: Vec<(PathBuf, bool)> = rd
        .filter_map(Result::ok)
        .filter(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            !n.starts_with('.') && !n.ends_with(".meta")
        })
        .map(|e| (e.path(), e.file_type().is_ok_and(|t| t.is_dir())))
        .collect();
    out.sort();
    out
}

struct Read {
    id: Option<String>,
    tags: Vec<String>,
    rating: u8,
    memo: String,
    aliases: Option<Vec<String>>,
    blocks: Option<Vec<Block>>,
}

fn read_note(path: &Path) -> Result<Read, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parts = note::split(&text);
    let v = note::front_values(parts.front)?;
    Ok(Read {
        id: note::str_of(&v, ID_KEY),
        tags: note::list_of(&v, "tags"),
        rating: 0,
        memo: String::new(),
        aliases: Some(note::list_of(&v, "aliases")),
        blocks: Some(note::blocks_of(parts.body)),
    })
}

fn read_asset(path: &Path) -> Result<Read, String> {
    let m = read_json(&meta_path(path))?.unwrap_or_default();
    Ok(Read {
        id: m.get(ID_KEY).and_then(Value::as_str).map(str::to_owned),
        tags: strings(m.get("tags")),
        rating: m
            .get("rating")
            .and_then(Value::as_u64)
            .map_or(0, |r| r.min(5) as u8),
        memo: m
            .get("memo")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        aliases: None,
        blocks: None,
    })
}

fn save_note(path: &Path, id: &str, patch: &ItemPatch) -> Result<(), String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let parts = note::split(&text);
    let mut front = note::set_key(parts.front.unwrap_or_default(), ID_KEY, &json!(id));
    if let Some(t) = &patch.tags {
        front = note::set_key(&front, "tags", &json!(t));
    }
    if let Some(a) = &patch.aliases {
        front = note::set_key(&front, "aliases", &json!(a));
    }
    let body = match &patch.blocks {
        Some(b) => note::body_of(b),
        None if parts.front.is_none() => format!("\n{}", parts.body),
        None => parts.body.to_owned(),
    };
    write_file(path, &note::join(&front, &body))
}

fn save_asset(path: &Path, id: &str, patch: &ItemPatch) -> Result<(), String> {
    let meta = meta_path(path);
    let mut m = read_json(&meta)?.unwrap_or_default();
    m.insert(ID_KEY.into(), json!(id));
    if let Some(t) = &patch.tags {
        m.insert("tags".into(), json!(t));
    }
    if let Some(r) = patch.rating {
        m.insert("rating".into(), json!(r.min(5)));
    }
    if let Some(s) = &patch.memo {
        m.insert("memo".into(), json!(s));
    }
    write_json(&meta, &m)
}
