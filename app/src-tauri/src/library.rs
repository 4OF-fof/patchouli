//! ライブラリのフォルダの読み書き。
//!
//! - 直下のフォルダがプロジェクト。フォルダの属性は同じ階層の `<名前>.meta`（JSON）に置く
//! - 素材の属性は `<ファイル名>.meta`（JSON）、ノートの属性は frontmatter に置く
//! - ピン留めとタグの表紙は `.patchouli/library.json` に置く
//! - `.` で始まるものは読まない（ほかのツールの設定や、書き込み途中のファイル）
//!
//! ID のない素材やノートは、読んだときに ID を書く（ノートの更新日時は変えない）。
//! 書けなかったものと、コピーで ID が重なったものには仮の ID を渡し、最初に保存するときに書く。
//!
//! 開いた結果は写し（`cache.rs`）に取っておき、次はまずそれを返してから、裏でファイルと突き合わせる。

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::cache::{Cache, Row, Sig};
use crate::note::{self, Block};
use crate::plugin::{FormatInfo, Registry};

pub const ID_KEY: &str = "patchouli-id";
const STATE_DIR: &str = ".patchouli";
const STATE_FILE: &str = "library.json";

/// ノートの拡張子。ノートはアプリが特別に扱う（本文とリンクを読み、frontmatter に属性を置く）。
pub const NOTE_EXT: &str = "md";

/// 画像の見た目の大きさ。写真の向き（EXIF）が 90 度回す指定なら、縦と横を入れ替える。
pub(crate) fn image_size(path: &Path) -> Option<(u32, u32)> {
    let s = imagesize::size(path).ok()?;
    let (w, h) = (s.width as u32, s.height as u32);
    let turned = File::open(path)
        .ok()
        .and_then(|f| {
            exif::Reader::new()
                .read_from_container(&mut BufReader::new(f))
                .ok()
        })
        .and_then(|e| {
            e.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?
                .value
                .get_uint(0)
        })
        .is_some_and(|o| (5..=8).contains(&o));
    Some(if turned { (h, w) } else { (w, h) })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredItem {
    pub id: String,
    pub note: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// 扱える形式。
    pub formats: Vec<FormatInfo>,
    /// 読めなかったもの（「パス: 理由」）。
    pub problems: Vec<String>,
}

/// ファイルを読んだ結果。
pub struct Scan {
    pub items: Vec<Row>,
    pub projects: Vec<StoredProject>,
    pub state: LibraryState,
    pub problems: Vec<String>,
}

/// 写しから開いたあとに、ファイルと突き合わせて見つかった違い。
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    /// 足されたものと変わったもの。
    pub items: Vec<StoredItem>,
    /// なくなったものの ID。
    pub removed: Vec<String>,
    /// 変わったときだけ、全部を入れる。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<StoredProject>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<LibraryState>,
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
    plugins: Arc<Registry>,
    cache: Arc<Cache>,
    /// 裏で突き合わせているあいだに書いたファイル。突き合わせた結果より、こちらを残す。
    touched: Option<HashSet<PathBuf>>,
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub(crate) fn mtime_of(path: &Path) -> f64 {
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

pub(crate) fn meta_path(path: &Path) -> PathBuf {
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

    pub fn plugins(&self) -> Arc<Registry> {
        Arc::clone(&self.plugins)
    }

    fn new(root: PathBuf, plugins: Arc<Registry>, cache: Arc<Cache>) -> Library {
        Library {
            root,
            entries: HashMap::new(),
            plugins,
            cache,
            touched: None,
        }
    }

    pub fn cache(&self) -> Arc<Cache> {
        Arc::clone(&self.cache)
    }

    fn state_path(&self) -> PathBuf {
        self.root.join(STATE_DIR).join(STATE_FILE)
    }

    /// 写しから開く。まだ写しがなければ None。root は canonical で正規化したもの。
    pub fn cached(
        root: &Path,
        plugins: Arc<Registry>,
        cache: Arc<Cache>,
    ) -> Option<(Library, Opened)> {
        let snap = cache.load()?;
        let mut lib = Library::new(root.to_owned(), plugins, cache);
        let items = snap
            .rows
            .into_iter()
            .filter(|r| lib.plugins.knows(&r.item.ext))
            .map(|r| {
                lib.entries.insert(
                    r.item.id.clone(),
                    Entry {
                        path: r.item.file.clone(),
                        note: r.item.note,
                        saved: r.saved,
                    },
                );
                r.item
            })
            .collect();
        lib.touched = Some(HashSet::new());
        let formats = lib.plugins.formats();
        Some((
            lib,
            Opened {
                root: root.to_owned(),
                items,
                projects: snap.projects,
                state: snap.state,
                formats,
                problems: vec![],
            },
        ))
    }

    /// ファイルを読む。更新日時が写しと同じものは、写しの中身を使う。
    pub fn scan(root: &Path, plugins: Arc<Registry>, cache: Arc<Cache>) -> (Library, Scan) {
        let known = cache.rows();
        let mut lib = Library::new(root.to_owned(), plugins, cache);
        let mut items = Vec::new();
        let mut projects = Vec::new();
        let mut problems = Vec::new();

        for (path, is_dir) in list_dir(root, &mut problems) {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_owned();
            if !is_dir {
                items.extend(lib.read_item(&path, None, known.get(&path), &mut problems));
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
            lib.read_dir(&path, &name, &known, &mut items, &mut problems);
            let mtime = items[from..]
                .iter()
                .map(|r| r.item.mtime)
                .fold(mtime_of(&path).max(mtime_of(&meta)), f64::max);
            projects.push(StoredProject { name, cover, mtime });
        }

        let state_path = lib.state_path();
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
        (
            lib,
            Scan {
                items,
                projects,
                state,
                problems,
            },
        )
    }

    /// 読んだ結果で写しを作り直し、開いた結果にする。
    pub fn opened(&self, scan: Scan) -> Opened {
        self.cache.replace(&scan.items, &scan.projects, &scan.state);
        Opened {
            root: self.root.clone(),
            items: scan.items.into_iter().map(|r| r.item).collect(),
            projects: scan.projects,
            state: scan.state,
            formats: self.plugins.formats(),
            problems: scan.problems,
        }
    }

    /// 写しから開いたあとに、裏で読んだ結果（fresh と scan）を取り込み、写しとの違いを返す。
    /// 読んでいるあいだに書いたものは、書いたほうを残す。
    pub fn apply(&mut self, fresh: Library, scan: Scan) -> Changes {
        let touched = self.touched.take().unwrap_or_default();
        let before = self.cache.rows();
        let mut changes = Changes {
            problems: scan.problems,
            ..Changes::default()
        };

        let mut seen = HashSet::new();
        let mut rows = Vec::new();
        for row in scan.items {
            let path = row.item.file.clone();
            seen.insert(path.clone());
            if touched.contains(&path) {
                continue;
            }
            match before.get(&path) {
                Some(b) if b.same_item(&row) => {
                    if b.sig != row.sig || b.saved != row.saved {
                        rows.push(row);
                    }
                    continue;
                }
                Some(b) if b.item.id != row.item.id => changes.removed.push(b.item.id.clone()),
                _ => {}
            }
            changes.items.push(row.item.clone());
            rows.push(row);
        }
        let mut gone = Vec::new();
        for (path, b) in before {
            if !seen.contains(&path) && !touched.contains(&path) {
                changes.removed.push(b.item.id);
                gone.push(path);
            }
        }
        self.cache.update(&rows, &gone);

        let mut entries = fresh.entries;
        entries.retain(|_, e| !touched.contains(&e.path));
        for (id, e) in self.entries.drain() {
            if touched.contains(&e.path) {
                entries.insert(id, e);
            }
        }
        self.entries = entries;

        let was = self.cache.projects();
        let kept = |name: &str| touched.contains(&self.root.join(name));
        let mut projects: Vec<StoredProject> = scan
            .projects
            .into_iter()
            .filter(|p| !kept(&p.name))
            .chain(was.iter().filter(|p| kept(&p.name)).cloned())
            .collect();
        projects.sort_by(|a, b| a.name.cmp(&b.name));
        if serde_json::to_value(&projects).ok() != serde_json::to_value(&was).ok() {
            self.cache.replace_projects(&projects);
            changes.projects = Some(projects);
        }

        if !touched.contains(&self.state_path())
            && serde_json::to_value(&scan.state).ok()
                != serde_json::to_value(self.cache.state()).ok()
        {
            self.cache.put_state(&scan.state);
            changes.state = Some(scan.state);
        }
        changes
    }

    /// 裏で突き合わせているあいだなら、書いたことを覚えておく。
    fn mark(&mut self, path: &Path) {
        if let Some(t) = &mut self.touched {
            t.insert(path.to_owned());
        }
    }

    fn read_dir(
        &mut self,
        dir: &Path,
        project: &str,
        known: &HashMap<PathBuf, Row>,
        items: &mut Vec<Row>,
        problems: &mut Vec<String>,
    ) {
        for (path, is_dir) in list_dir(dir, problems) {
            if is_dir {
                self.read_dir(&path, project, known, items, problems);
            } else {
                items.extend(self.read_item(&path, Some(project), known.get(&path), problems));
            }
        }
    }

    /// 扱えるファイルを読む。known は写しにある、このファイルの行。
    pub(crate) fn read_item(
        &mut self,
        path: &Path,
        folder: Option<&str>,
        known: Option<&Row>,
        problems: &mut Vec<String>,
    ) -> Option<Row> {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if !self.plugins.knows(&ext) {
            return None;
        }
        let note = ext == NOTE_EXT;
        let sig = Sig::of(path, note);
        // 写しの ID を使えるのは、ほかのファイルがまだ使っていないときだけ
        let free = |k: &&Row| !self.entries.contains_key(&k.item.id);
        if let Some(k) = known.filter(|k| k.sig == sig).filter(free) {
            self.entries.insert(
                k.item.id.clone(),
                Entry {
                    path: path.to_owned(),
                    note,
                    saved: k.saved,
                },
            );
            return Some(k.clone());
        }
        let name = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_owned();
        let read = if note {
            read_note(path)
        } else {
            read_asset(path)
        };
        let mut r = match read {
            Ok(r) => r,
            Err(e) => {
                problems.push(format!("{}: {e}", path.display()));
                return None;
            }
        };
        let missing = r.id.is_none();
        // コピーしたファイルは ID が重なる。あとから見つけたほうに仮の ID を渡す
        let mut saved = matches!(&r.id, Some(id) if !self.entries.contains_key(id));
        let id = if saved {
            r.id.take().unwrap_or_default()
        } else if let Some(k) = known.filter(|k| !k.saved).filter(free) {
            k.item.id.clone()
        } else {
            new_id()
        };
        let mut sig = sig;
        if missing {
            match write_id(path, note, &id) {
                Ok(()) => {
                    saved = true;
                    sig = Sig::of(path, note);
                }
                Err(e) => log::warn!("ID を書けない: {e}"),
            }
        }
        self.entries.insert(
            id.clone(),
            Entry {
                path: path.to_owned(),
                note,
                saved,
            },
        );
        Some(Row {
            item: StoredItem {
                id,
                note,
                name,
                ext,
                folder: folder.map(str::to_owned),
                tags: r.tags,
                rating: r.rating,
                memo: r.memo,
                aliases: r.aliases,
                blocks: r.blocks,
                mtime: mtime_of(path),
                width: None,
                height: None,
                file: path.to_owned(),
                thumb: None,
            },
            saved,
            sig,
        })
    }

    /// 書いた項目 id を読み直して、写しに入れる。
    fn refresh(&mut self, id: &str) {
        let Ok(e) = self.entry(id) else {
            return;
        };
        let (path, note) = (e.path.clone(), e.note);
        self.mark(&path);
        let Some(mut row) = self.cache.row(&path) else {
            return;
        };
        let read = if note {
            read_note(&path)
        } else {
            read_asset(&path)
        };
        let Ok(r) = read else {
            return;
        };
        let it = &mut row.item;
        (it.tags, it.rating, it.memo, it.aliases, it.blocks) =
            (r.tags, r.rating, r.memo, r.aliases, r.blocks);
        it.mtime = mtime_of(&path);
        row.saved = true;
        row.sig = Sig::of(&path, note);
        self.cache.update(&[row], &[]);
    }

    /// 取り込んだり作ったりした項目を写しに入れる。
    pub(crate) fn remember(&mut self, row: &Row) {
        self.mark(&row.item.file);
        self.cache.update(std::slice::from_ref(row), &[]);
    }

    fn entry(&self, id: &str) -> Result<&Entry, String> {
        self.entries
            .get(id)
            .ok_or_else(|| format!("ID {id} の項目がない"))
    }

    /// 素材のファイルと、拡張子（小文字）。
    pub fn asset(&self, id: &str) -> Result<(&Path, String), String> {
        let e = self.entry(id)?;
        if e.note {
            return Err(format!("ID {id} はノート"));
        }
        let ext = e
            .path
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_lowercase();
        Ok((&e.path, ext))
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
        self.refresh(id);
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
        let path = self.state_path();
        write_json(&path, &m)?;
        self.mark(&path);
        self.cache.put_state(state);
        Ok(())
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
        let path = dir.join(format!("{name}.{NOTE_EXT}"));
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
        let item = StoredItem {
            id,
            note: true,
            name: name.to_owned(),
            ext: NOTE_EXT.into(),
            folder: folder.map(str::to_owned),
            tags: vec![],
            rating: 0,
            memo: String::new(),
            aliases: Some(vec![]),
            blocks: Some(vec![]),
            mtime: mtime_of(&path),
            width: None,
            height: None,
            file: path.clone(),
            thumb: None,
        };
        self.remember(&Row {
            item: item.clone(),
            saved: true,
            sig: Sig::of(&path, true),
        });
        Ok(item)
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
        let p = StoredProject {
            name: name.to_owned(),
            cover: json!([]),
            mtime: mtime_of(&meta),
        };
        self.mark(&dir);
        self.cache.put_project(&p);
        Ok(p)
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
        m.insert("cover".into(), cover.clone());
        write_json(&meta, &m)?;
        self.mark(&dir);
        if let Some(mut p) = self.cache.projects().into_iter().find(|p| p.name == name) {
            p.cover = cover;
            p.mtime = p.mtime.max(mtime_of(&meta));
            self.cache.put_project(&p);
        }
        Ok(())
    }
}

/// 開くライブラリの場所を、写しやサムネイルの置き場所を決めるのに使う形にする。
pub fn canonical(root: &Path) -> Result<PathBuf, String> {
    let p = fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
    Ok(dunce(p))
}

/// ID をファイルに書く。ノートは本文のファイルを書き直すので、更新日時を戻す（ID を足しただけで、最近動いたものにしない）。
fn write_id(path: &Path, note: bool, id: &str) -> Result<(), String> {
    if !note {
        return save_asset(path, id, &ItemPatch::default());
    }
    let at = |e: std::io::Error| format!("{}: {e}", path.display());
    let t = fs::metadata(path).and_then(|m| m.modified()).map_err(at)?;
    save_note(path, id, &ItemPatch::default())?;
    File::options()
        .write(true)
        .open(path)
        .and_then(|f| f.set_modified(t))
        .map_err(at)
}

/// Windows の canonicalize が付ける `\\?\` を外す。
pub(crate) fn dunce(p: PathBuf) -> PathBuf {
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
