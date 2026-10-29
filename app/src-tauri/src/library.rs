use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::cache::{Cache, Row, Sig};
use crate::cover;
use crate::note;
use crate::plugin::{FormatInfo, Registry};

pub const ID_KEY: &str = "patchouli-id";
const STATE_DIR: &str = ".patchouli";
const STATE_FILE: &str = "library.json";
const PROJECTS_DIR: &str = "projects";
const TAGS_DIR: &str = "tags";
const TAG_INDEX: &str = "index.json";

pub const NOTE_EXT: &str = "md";

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
    pub memo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub mtime: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub file: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub name: String,
    pub cover: Value,
    pub mtime: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryState {
    pub pins: Vec<String>,
    pub pinned_projects: Vec<String>,
    pub pinned_tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub root: PathBuf,
    pub items: Vec<StoredItem>,
    pub projects: Vec<StoredProject>,
    pub state: LibraryState,
    pub tag_covers: Map<String, Value>,
    pub formats: Vec<FormatInfo>,
    pub problems: Vec<String>,
}

pub struct Scan {
    pub items: Vec<Row>,
    pub projects: Vec<StoredProject>,
    pub state: LibraryState,
    pub tag_covers: Map<String, Value>,
    pub problems: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub items: Vec<StoredItem>,
    pub removed: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<StoredProject>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<LibraryState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_covers: Option<Map<String, Value>>,
    pub problems: Vec<String>,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
            && self.removed.is_empty()
            && self.projects.is_none()
            && self.state.is_none()
            && self.tag_covers.is_none()
            && self.problems.is_empty()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ListDiff {
    pub add: Vec<String>,
    pub remove: Vec<String>,
}

impl ListDiff {
    fn apply(&self, mut list: Vec<String>) -> Vec<String> {
        list.retain(|x| !self.remove.contains(x));
        for x in &self.add {
            if !list.contains(x) {
                list.push(x.clone());
            }
        }
        list
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemPatch {
    pub tags: Option<ListDiff>,
    pub aliases: Option<ListDiff>,
    pub memo: Option<String>,
    pub body: Option<String>,
}

impl ItemPatch {
    fn has_text(&self) -> bool {
        self.memo.is_some() || self.body.is_some()
    }
}

struct Entry {
    path: PathBuf,
    note: bool,
    saved: bool,
}

pub struct Library {
    root: PathBuf,
    entries: HashMap<String, Entry>,
    plugins: Arc<Registry>,
    cache: Arc<Cache>,
    /// 裏で突き合わせているあいだに書いたファイル。突き合わせた結果より、こちらを残す。
    touched: Option<HashSet<PathBuf>>,
    /// 写しで、その ID をファイルに書いてあったもの。コピーで ID が重なったとき、元のほうに ID を残すのに使う。
    owners: HashMap<String, PathBuf>,
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
            Ok(_) => Err("内容が JSON オブジェクトではありません".into()),
            Err(e) => Err(format!("JSON の読み込みに失敗しました：{e}")),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 同じフォルダに一時ファイルを書いてから置き換える。同期ソフトに書きかけを拾わせない。
pub(crate) fn write_file(path: &Path, text: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("ファイル名がありません")?;
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

pub fn check_name(name: &str) -> Result<(), String> {
    let bad = name.trim().is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c));
    if bad {
        Err(format!("「{name}」は名前として使用できません"))
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

    pub fn set_plugins(&mut self, plugins: Arc<Registry>) {
        self.plugins = plugins;
    }

    pub fn snapshot(&self) -> Opened {
        let snap = self.cache.load().unwrap_or_else(|| crate::cache::Snapshot {
            rows: Vec::new(),
            projects: Vec::new(),
            state: LibraryState::default(),
            tag_covers: Map::new(),
        });
        Opened {
            root: self.root.clone(),
            items: snap.rows.into_iter().map(|r| r.item).collect(),
            projects: snap.projects,
            state: snap.state,
            tag_covers: snap.tag_covers,
            formats: self.plugins.formats(),
            problems: vec![],
        }
    }

    fn new(root: PathBuf, plugins: Arc<Registry>, cache: Arc<Cache>) -> Library {
        Library {
            root,
            entries: HashMap::new(),
            plugins,
            cache,
            touched: None,
            owners: HashMap::new(),
        }
    }

    pub fn cache(&self) -> Arc<Cache> {
        Arc::clone(&self.cache)
    }

    fn state_path(&self) -> PathBuf {
        self.root.join(STATE_DIR).join(STATE_FILE)
    }

    fn cards_dir(&self, id: &str) -> PathBuf {
        self.root.join(STATE_DIR).join(PROJECTS_DIR).join(id)
    }

    fn tags_dir(&self) -> PathBuf {
        self.root.join(STATE_DIR).join(TAGS_DIR)
    }

    fn read_tag_covers(&self, problems: &mut Vec<String>) -> Map<String, Value> {
        let path = self.tags_dir().join(TAG_INDEX);
        let index = read_json(&path).unwrap_or_else(|e| {
            problems.push(format!("{}: {e}", path.display()));
            None
        });
        let mut covers = Map::new();
        for (tag, id) in index.unwrap_or_default() {
            match id.as_str().filter(|id| check_name(id).is_ok()) {
                Some(id) => {
                    let (cover, _) = cover::read(&self.tags_dir().join(id), problems);
                    covers.insert(tag, cover);
                }
                None => problems.push(format!("{}: 「{tag}」の id が読めません", path.display())),
            }
        }
        covers
    }

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
                tag_covers: snap.tag_covers,
                formats,
                problems: vec![],
            },
        ))
    }

    pub fn scan(root: &Path, plugins: Arc<Registry>, cache: Arc<Cache>) -> (Library, Scan) {
        let known = cache.rows();
        let mut lib = Library::new(root.to_owned(), plugins, cache);
        lib.owners = known
            .iter()
            .filter(|(_, r)| r.saved)
            .map(|(p, r)| (r.item.id.clone(), p.clone()))
            .collect();
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
            let id = match read_json(&meta) {
                Ok(m) => m.and_then(|m| m.get(ID_KEY)?.as_str().map(str::to_owned)),
                Err(e) => {
                    problems.push(format!("{}: {e}", meta.display()));
                    None
                }
            };
            let (cover, cover_mtime) = match id.filter(|id| check_name(id).is_ok()) {
                Some(id) => cover::read(&lib.cards_dir(&id), &mut problems),
                None => (json!([]), 0.0),
            };
            let from = items.len();
            lib.read_dir(&path, &name, &known, &mut items, &mut problems);
            let mtime = items[from..].iter().map(|r| r.item.mtime).fold(
                mtime_of(&path).max(mtime_of(&meta)).max(cover_mtime),
                f64::max,
            );
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
        let tag_covers = lib.read_tag_covers(&mut problems);
        (
            lib,
            Scan {
                items,
                projects,
                state,
                tag_covers,
                problems,
            },
        )
    }

    pub fn opened(&self, scan: Scan) -> Opened {
        self.cache
            .replace(&scan.items, &scan.projects, &scan.state, &scan.tag_covers);
        Opened {
            root: self.root.clone(),
            items: scan.items.into_iter().map(|r| r.item).collect(),
            projects: scan.projects,
            state: scan.state,
            tag_covers: scan.tag_covers,
            formats: self.plugins.formats(),
            problems: scan.problems,
        }
    }

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

        if !touched.contains(&self.tags_dir()) && scan.tag_covers != self.cache.tag_covers() {
            self.cache.put_tag_covers(&scan.tag_covers);
            changes.tag_covers = Some(scan.tag_covers);
        }
        changes
    }

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
        // コピーしたファイルは ID が重なる。元のほう（写しでその ID だったもの）に残し、ほかには新しい ID を書く
        let owned = |id: &str| {
            !self.entries.contains_key(id)
                && self.owners.get(id).is_none_or(|p| p == path || !p.exists())
        };
        let mut saved = r.id.as_deref().is_some_and(owned);
        let id = if saved {
            r.id.take().unwrap_or_default()
        } else if let Some(k) = known.filter(|k| !k.saved).filter(free) {
            k.item.id.clone()
        } else {
            new_id()
        };
        let mut sig = sig;
        if !saved {
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
                memo: r.memo,
                aliases: r.aliases,
                body: r.body,
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

    fn refresh(&mut self, id: &str) -> Option<StoredItem> {
        let e = self.entry(id).ok()?;
        let (path, note) = (e.path.clone(), e.note);
        self.mark(&path);
        let mut row = self.cache.row(&path)?;
        let read = if note {
            read_note(&path)
        } else {
            read_asset(&path)
        };
        let r = read.ok()?;
        let it = &mut row.item;
        (it.tags, it.memo, it.aliases, it.body) = (r.tags, r.memo, r.aliases, r.body);
        it.mtime = mtime_of(&path);
        row.saved = true;
        row.sig = Sig::of(&path, note);
        self.cache.update(std::slice::from_ref(&row), &[]);
        Some(row.item)
    }

    pub(crate) fn remember(&mut self, row: &Row) {
        self.mark(&row.item.file);
        self.cache.update(std::slice::from_ref(row), &[]);
    }

    fn entry(&self, id: &str) -> Result<&Entry, String> {
        self.entries
            .get(id)
            .ok_or_else(|| format!("ID「{id}」の項目が見つかりません"))
    }

    pub fn path(&self, id: &str) -> Result<&Path, String> {
        Ok(&self.entry(id)?.path)
    }

    pub fn asset(&self, id: &str) -> Result<(&Path, String), String> {
        let e = self.entry(id)?;
        if e.note {
            return Err(format!("ID「{id}」はノートのため、素材として扱えません"));
        }
        let ext = e
            .path
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_lowercase();
        Ok((&e.path, ext))
    }

    pub fn save_item(&mut self, id: &str, patch: &ItemPatch) -> Result<Option<StoredItem>, String> {
        let e = self.entry(id)?;
        let (path, note) = (e.path.clone(), e.note);
        let changed = patch.has_text()
            && self
                .cache
                .row(&path)
                .is_some_and(|r| r.sig != Sig::of(&path, note));
        let stripped;
        let patch = if changed {
            stripped = ItemPatch {
                tags: patch.tags.clone(),
                aliases: patch.aliases.clone(),
                memo: None,
                body: None,
            };
            &stripped
        } else {
            patch
        };
        if note {
            save_note(&path, id, patch)?
        } else {
            save_asset(&path, id, patch)?
        }
        if let Some(e) = self.entries.get_mut(id) {
            e.saved = true;
        }
        let item = self.refresh(id);
        Ok(item.filter(|_| changed))
    }

    pub fn move_item(&mut self, id: &str, folder: Option<&str>) -> Result<StoredItem, String> {
        // 生成物は ID で引くので、ID をメタ情報に書いてから動かす
        self.ensure_saved(id)?;
        let from = self.entry(id)?.path.clone();
        let row = self.row_of(&from)?;
        if row.item.folder.as_deref() == folder {
            return Ok(row.item);
        }
        let dir = match folder {
            Some(f) => {
                let d = self.project_dir(f)?;
                if !d.is_dir() {
                    return Err(format!("プロジェクト「{f}」が見つかりません"));
                }
                d
            }
            None => self.root.clone(),
        };
        let name = from.file_name().ok_or("ファイル名がありません")?;
        let place = folder.unwrap_or("プロジェクトなし");
        let taken = format!(
            "「{place}」に同じ名前のファイル（{}）があるため、移動できません",
            name.to_string_lossy()
        );
        let to = dir.join(name);
        self.relocate(id, row, &to, taken, |it| {
            it.folder = folder.map(str::to_owned);
        })
    }

    pub fn rename_item(&mut self, id: &str, name: &str) -> Result<StoredItem, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("名前を入れてください".into());
        }
        if name.ends_with('.')
            || name
                .chars()
                .any(|c| c.is_control() || r#"\/:*?"<>|"#.contains(c))
        {
            return Err(
                r#"名前に使えない文字（\ / : * ? " < > | と末尾の .）が入っています"#.into(),
            );
        }
        // 生成物は ID で引くので、ID をメタ情報に書いてから動かす
        self.ensure_saved(id)?;
        let from = self.entry(id)?.path.clone();
        let row = self.row_of(&from)?;
        if row.item.name == name {
            return Ok(row.item);
        }
        let file = match from.extension() {
            Some(ext) => format!("{name}.{}", ext.to_string_lossy()),
            None => name.to_owned(),
        };
        let to = from.with_file_name(&file);
        let taken = format!("同じ名前のファイル（{file}）があるため、名前を変えられません");
        self.relocate(id, row, &to, taken, |it| it.name = name.to_owned())
    }

    /// ファイルとメタ情報をごみ箱に入れ、ライブラリから外す。
    pub fn delete_item(&mut self, id: &str) -> Result<(), String> {
        let e = self.entry(id)?;
        let (path, note) = (e.path.clone(), e.note);
        let meta = meta_path(&path);
        let mut files = vec![path.clone()];
        if !note && meta.exists() {
            files.push(meta);
        }
        trash::delete_all(&files).map_err(|e| format!("{}: {e}", path.display()))?;
        for f in &files {
            self.mark(f);
        }
        self.entries.remove(id);
        if self.owners.get(id) == Some(&path) {
            self.owners.remove(id);
        }
        self.cache.update(&[], &[path]);
        Ok(())
    }

    fn row_of(&self, path: &Path) -> Result<Row, String> {
        self.cache
            .row(path)
            .ok_or_else(|| format!("{} が見つかりません", path.display()))
    }

    /// ファイルとメタ情報を to に移し、キャッシュを付け替える。サムネイルなどは ID で引くので、そのまま使える。
    fn relocate(
        &mut self,
        id: &str,
        mut row: Row,
        to: &Path,
        taken: String,
        change: impl FnOnce(&mut StoredItem),
    ) -> Result<StoredItem, String> {
        let from = row.item.file.clone();
        let (meta_from, meta_to) = (meta_path(&from), meta_path(to));
        let has_meta = !row.item.note && meta_from.exists();
        // 大文字と小文字だけを変えるときは、変える前のものが見つかる
        let other =
            |a: &Path, b: &Path| b.exists() && fs::canonicalize(a).ok() != fs::canonicalize(b).ok();
        if other(&from, to) || (has_meta && other(&meta_from, &meta_to)) {
            return Err(taken);
        }
        fs::rename(&from, to).map_err(|e| format!("{}: {e}", from.display()))?;
        if has_meta && let Err(e) = fs::rename(&meta_from, &meta_to) {
            let _ = fs::rename(to, &from);
            return Err(format!("{}: {e}", meta_from.display()));
        }
        self.mark(&from);
        self.mark(to);
        if let Some(e) = self.entries.get_mut(id) {
            e.path = to.to_owned();
        }
        let reads = self.cache.thumb_reads().remove(&from).unwrap_or_default();
        row.item.file = to.to_owned();
        change(&mut row.item);
        self.cache.update(std::slice::from_ref(&row), &[from]);
        if let Some(t) = &row.item.thumb {
            let size = row.item.width.zip(row.item.height).unwrap_or_default();
            self.cache.set_thumb(to, t, size, &reads);
        }
        Ok(row.item)
    }

    /// ノートのリンクの表示名を、リンク先のいまの名前に書き換える。書き換えたノートを返す。
    pub fn sync_link_names(&mut self) -> Vec<StoredItem> {
        let rows = self.cache.rows();
        let names: HashMap<&str, &str> = rows
            .values()
            .map(|r| (r.item.id.as_str(), r.item.name.as_str()))
            .collect();
        // 外で変わったまま読み直していないものは、読み直したあとに回す
        let stale: Vec<(String, String)> = rows
            .values()
            .filter(|r| r.item.note && r.sig == Sig::of(&r.item.file, true))
            .filter_map(|r| {
                let body = r.item.body.as_deref()?;
                let new = note::rename_links(body, |id| names.get(id).copied())?;
                Some((r.item.id.clone(), new))
            })
            .collect();
        stale
            .into_iter()
            .filter_map(|(id, body)| {
                let patch = ItemPatch {
                    body: Some(body),
                    ..ItemPatch::default()
                };
                match self.save_item(&id, &patch) {
                    Ok(Some(it)) => Some(it),
                    Ok(None) => {
                        let path = self.entry(&id).ok()?.path.clone();
                        self.cache.row(&path).map(|r| r.item)
                    }
                    Err(e) => {
                        log::warn!("リンクの表示名を書き換えられない: {e}");
                        None
                    }
                }
            })
            .collect()
    }

    fn ensure_saved(&mut self, id: &str) -> Result<(), String> {
        match self.entries.get(id) {
            Some(e) if !e.saved => self.save_item(id, &ItemPatch::default()).map(drop),
            _ => Ok(()),
        }
    }

    pub fn save_state(&mut self, state: &LibraryState) -> Result<(), String> {
        for id in &state.pins {
            self.ensure_saved(id)?;
        }
        let dir = self.root.join(STATE_DIR);
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let Value::Object(s) = serde_json::to_value(state).map_err(|e| e.to_string())? else {
            unreachable!()
        };
        // 同じファイルにあるプラグインの記録（plugin/record.rs）は残す
        let path = self.state_path();
        let mut m = read_json(&path)?.unwrap_or_default();
        m.extend(s);
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
        // 画面の知らないファイルがあっても作れるよう、かぶったら番号を付ける
        let base = name;
        let mut name = base.to_owned();
        for k in 2.. {
            if !dir.join(format!("{name}.{NOTE_EXT}")).exists() {
                break;
            }
            name = format!("{base} {k}");
        }
        let path = dir.join(format!("{name}.{NOTE_EXT}"));
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
            name,
            ext: NOTE_EXT.into(),
            folder: folder.map(str::to_owned),
            tags: vec![],
            memo: String::new(),
            aliases: Some(vec![]),
            body: Some(String::new()),
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
            return Err(format!("プロジェクト「{name}」はすでに存在します"));
        }
        fs::create_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let mut m = Map::new();
        m.insert(ID_KEY.into(), json!(new_id()));
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
            return Err(format!("プロジェクト「{name}」が見つかりません"));
        }
        let meta = meta_path(&dir);
        let mut m = read_json(&meta)?.unwrap_or_default();
        let id = match m.get(ID_KEY).and_then(Value::as_str) {
            Some(id) => id.to_owned(),
            None => {
                let id = new_id();
                m.insert(ID_KEY.into(), json!(id));
                write_json(&meta, &m)?;
                id
            }
        };
        check_name(&id)?;
        let cards = self.cards_dir(&id);
        cover::write(&cards, &cover)?;
        self.mark(&dir);
        if let Some(mut p) = self.cache.projects().into_iter().find(|p| p.name == name) {
            p.cover = cover;
            p.mtime = p.mtime.max(mtime_of(&cards.join(cover::LAYOUT)));
            self.cache.put_project(&p);
        }
        Ok(())
    }

    pub fn save_tag_cover(&mut self, tag: &str, cover: Value) -> Result<(), String> {
        let dir = self.tags_dir();
        let index_path = dir.join(TAG_INDEX);
        let mut index = read_json(&index_path)?.unwrap_or_default();
        let id = match index.get(tag).and_then(Value::as_str) {
            Some(id) => id.to_owned(),
            None => {
                let id = new_id();
                fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
                index.insert(tag.to_owned(), json!(id));
                write_json(&index_path, &index)?;
                id
            }
        };
        check_name(&id)?;
        cover::write(&dir.join(&id), &cover)?;
        self.mark(&dir);
        let mut covers = self.cache.tag_covers();
        covers.insert(tag.to_owned(), cover);
        self.cache.put_tag_covers(&covers);
        Ok(())
    }

    /// 下の階層のタグも合わせて付け替える。変えた先の名前がすでにあれば、そちらを残す。
    pub fn rename_tag(&mut self, from: &str, to: &str) -> Result<(), String> {
        let re = |t: &str| {
            if t == from {
                Some(to.to_owned())
            } else {
                t.strip_prefix(from)
                    .filter(|rest| rest.starts_with('/'))
                    .map(|rest| format!("{to}{rest}"))
            }
        };
        let rekey = |m: Map<String, Value>| {
            let (moved, kept): (Vec<_>, Vec<_>) = m.into_iter().partition(|(t, _)| re(t).is_some());
            let mut next: Map<String, Value> = kept.into_iter().collect();
            for (t, v) in moved {
                next.entry(re(&t).unwrap_or(t)).or_insert(v);
            }
            next
        };
        let dir = self.tags_dir();
        let index_path = dir.join(TAG_INDEX);
        let Some(index) = read_json(&index_path)? else {
            return Ok(());
        };
        let next = rekey(index.clone());
        if next == index {
            return Ok(());
        }
        write_json(&index_path, &next)?;
        self.mark(&dir);
        self.cache.put_tag_covers(&rekey(self.cache.tag_covers()));
        Ok(())
    }
}

pub fn canonical(root: &Path) -> Result<PathBuf, String> {
    let p = fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
    Ok(dunce(p))
}

fn write_id(path: &Path, note: bool, id: &str) -> Result<(), String> {
    if note {
        save_note(path, id, &ItemPatch::default())
    } else {
        save_asset(path, id, &ItemPatch::default())
    }
}

/// Windows の canonicalize が付ける `\\?\` を外す。
pub(crate) fn dunce(p: PathBuf) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(s) if !s.starts_with("UNC\\") => PathBuf::from(s),
        _ => p,
    }
}

#[cfg(windows)]
fn hidden(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    fs::metadata(path).is_ok_and(|m| m.file_attributes() & (HIDDEN | SYSTEM) != 0)
}

#[cfg(not(windows))]
fn hidden(_: &Path) -> bool {
    false
}

pub(crate) fn listed(path: &Path) -> bool {
    let n = path.file_name().unwrap_or_default().to_string_lossy();
    !n.starts_with('.') && !n.ends_with(".meta") && !hidden(path)
}

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
        .filter(|e| listed(&e.path()))
        .map(|e| (e.path(), e.file_type().is_ok_and(|t| t.is_dir())))
        .collect();
    out.sort();
    out
}

struct Read {
    id: Option<String>,
    tags: Vec<String>,
    memo: String,
    aliases: Option<Vec<String>>,
    body: Option<String>,
}

fn read_note(path: &Path) -> Result<Read, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parts = note::split(&text);
    let v = note::front_values(parts.front)?;
    Ok(Read {
        id: note::str_of(&v, ID_KEY),
        tags: note::list_of(&v, "tags"),
        memo: String::new(),
        aliases: Some(note::list_of(&v, "aliases")),
        body: Some(parts.body.trim_start_matches(['\r', '\n']).to_owned()),
    })
}

fn read_asset(path: &Path) -> Result<Read, String> {
    let m = read_json(&meta_path(path))?.unwrap_or_default();
    Ok(Read {
        id: m.get(ID_KEY).and_then(Value::as_str).map(str::to_owned),
        tags: strings(m.get("tags")),
        memo: m
            .get("memo")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        aliases: None,
        body: None,
    })
}

fn save_note(path: &Path, id: &str, patch: &ItemPatch) -> Result<(), String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let parts = note::split(&text);
    let mut front = note::set_key(parts.front.unwrap_or_default(), ID_KEY, &json!(id));
    let lists = [("tags", &patch.tags), ("aliases", &patch.aliases)];
    if lists.iter().any(|(_, d)| d.is_some()) {
        let v = note::front_values(parts.front)?;
        for (key, diff) in lists {
            if let Some(d) = diff {
                front = note::set_key(&front, key, &json!(d.apply(note::list_of(&v, key))));
            }
        }
    }
    let body = match &patch.body {
        Some(b) => format!("\n{}", b.trim_start_matches(['\r', '\n'])),
        None if parts.front.is_none() => format!("\n{}", parts.body),
        None => parts.body.to_owned(),
    };
    write_file(path, &note::join(&front, &body))
}

fn save_asset(path: &Path, id: &str, patch: &ItemPatch) -> Result<(), String> {
    let meta = meta_path(path);
    let mut m = read_json(&meta)?.unwrap_or_default();
    m.insert(ID_KEY.into(), json!(id));
    if let Some(d) = &patch.tags {
        let tags = d.apply(strings(m.get("tags")));
        m.insert("tags".into(), json!(tags));
    }
    if let Some(s) = &patch.memo {
        m.insert("memo".into(), json!(s));
    }
    write_json(&meta, &m)
}
