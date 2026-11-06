pub mod cache;
pub(crate) mod cover;
pub mod import;
pub(crate) mod ipc;
pub mod note;
pub(crate) mod orphan;

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use cache::{Cache, Row, Sig};
use orphan::Orphan;

use crate::plugin::{FormatInfo, LinkInfo, Registry, ScreenInfo};

pub const ID_KEY: &str = "patchouli-id";
pub const TYPE_KEY: &str = "patchouli-type";
pub const PRINT_KEY: &str = "patchouli-print";
pub const PROJECT_TYPE: &str = "project";
pub(crate) const STATE_DIR: &str = ".patchouli";
const STATE_FILE: &str = "library.json";
const TAG_HISTORY: &str = "tag-history.json";
const OPEN_HISTORY: &str = "open-history.json";
const TABS: &str = "tabs.json";
pub(crate) const PROJECTS_DIR: &str = "projects";
pub(crate) const TAGS_DIR: &str = "tags";
pub(crate) const TAG_INDEX: &str = "index.json";

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredItem {
    pub id: String,
    pub note: bool,
    pub name: String,
    pub ext: String,
    pub project: Option<String>,
    pub group: Option<String>,
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
    /// thumb を波形から描いたもの。音声のサムネイルは、これでなければジャケット
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub wave_thumb: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub print: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub name: String,
    pub cover: Value,
    pub mtime: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredGroup {
    pub id: String,
    pub name: String,
    pub project: Option<String>,
    pub parent: Option<String>,
    /// プラグインが足す特殊なグループの種類。ただのグループは持たない
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub dir: PathBuf,
    pub mtime: f64,
}

/// 素材を置く場所。group があれば、project はそのグループのものに合わせる
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Place {
    pub project: Option<String>,
    pub group: Option<String>,
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
    pub groups: Vec<StoredGroup>,
    pub state: LibraryState,
    pub tag_covers: Map<String, Value>,
    pub orphans: Vec<Orphan>,
    pub formats: Vec<FormatInfo>,
    pub links: Vec<LinkInfo>,
    pub screens: Vec<ScreenInfo>,
    pub problems: Vec<String>,
}

pub struct Scan {
    pub items: Vec<Row>,
    pub projects: Vec<StoredProject>,
    pub groups: Vec<StoredGroup>,
    pub state: LibraryState,
    pub tag_covers: Map<String, Value>,
    pub orphans: Vec<Orphan>,
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
    pub groups: Option<Vec<StoredGroup>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<LibraryState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_covers: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orphans: Option<Vec<Orphan>>,
    pub problems: Vec<String>,
    /// 名前が変わっていたものの ID と前の名前。
    #[serde(skip)]
    pub renamed: HashMap<String, String>,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
            && self.removed.is_empty()
            && self.projects.is_none()
            && self.groups.is_none()
            && self.state.is_none()
            && self.tag_covers.is_none()
            && self.orphans.is_none()
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
    orphans: Vec<Orphan>,
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

fn unusable(name: &str) -> String {
    format!("「{name}」は名前として使用できません")
}

/// ファイル名に使えない文字を含むか。
fn bad_chars(name: &str) -> bool {
    name.chars()
        .any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c))
}

pub fn check_name(name: &str) -> Result<(), String> {
    let bad = name.trim().is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || bad_chars(name);
    if bad { Err(unusable(name)) } else { Ok(()) }
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

    pub fn snapshot(&self) -> Result<Opened, String> {
        let snap = self
            .cache
            .load()?
            .unwrap_or_else(|| crate::library::cache::Snapshot {
                rows: Vec::new(),
                projects: Vec::new(),
                groups: Vec::new(),
                state: LibraryState::default(),
                tag_covers: Map::new(),
            });
        Ok(Opened {
            root: self.root.clone(),
            items: snap.rows.into_iter().map(|r| r.item).collect(),
            projects: snap.projects,
            groups: snap.groups,
            state: snap.state,
            tag_covers: snap.tag_covers,
            orphans: self.orphans.clone(),
            formats: self.plugins.formats(),
            links: self.plugins.links(),
            screens: self.plugins.screens(),
            problems: vec![],
        })
    }

    fn new(root: PathBuf, plugins: Arc<Registry>, cache: Arc<Cache>) -> Library {
        Library {
            root,
            entries: HashMap::new(),
            plugins,
            cache,
            touched: None,
            owners: HashMap::new(),
            orphans: Vec::new(),
        }
    }

    pub fn cache(&self) -> Arc<Cache> {
        Arc::clone(&self.cache)
    }

    fn state_path(&self) -> PathBuf {
        self.root.join(STATE_DIR).join(STATE_FILE)
    }

    fn cards_dir(&self, id: &str) -> PathBuf {
        cards_dir(&self.root, id)
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
                None => problems.push(format!(
                    "{}: タグ「{tag}」の ID の読み込みに失敗しました",
                    path.display()
                )),
            }
        }
        covers
    }

    pub fn cached(
        root: &Path,
        plugins: Arc<Registry>,
        cache: Arc<Cache>,
    ) -> Option<(Library, Opened)> {
        // 読めなければ、写しを使わずに初めから読む
        let snap = cache
            .load()
            .inspect_err(|e| log::warn!("{e}"))
            .ok()
            .flatten()?;
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
        let links = lib.plugins.links();
        let screens = lib.plugins.screens();
        Some((
            lib,
            Opened {
                root: root.to_owned(),
                items,
                projects: snap.projects,
                groups: snap.groups,
                state: snap.state,
                tag_covers: snap.tag_covers,
                orphans: vec![],
                formats,
                links,
                screens,
                problems: vec![],
            },
        ))
    }

    /// 写しを読めないときは、つなぎ直しや片付けを空の写しで決めてしまわないよう、読まずに Err を返す。
    pub fn scan(
        root: &Path,
        plugins: Arc<Registry>,
        cache: Arc<Cache>,
    ) -> Result<(Library, Scan), String> {
        let known = cache.rows()?;
        let mut lib = Library::new(root.to_owned(), plugins, cache);
        lib.owners = known
            .iter()
            .filter(|(_, r)| r.saved)
            .map(|(p, r)| (r.item.id.clone(), p.clone()))
            .collect();
        let mut f = Found {
            known: &known,
            tend: orphan::Tend::new(root, &known),
            items: Vec::new(),
            groups: Vec::new(),
            problems: Vec::new(),
        };
        let mut projects = Vec::new();

        for Listed {
            path,
            is_dir,
            times,
        } in list_dir(root, &mut f)
        {
            if !is_dir {
                let row =
                    lib.read_item(&path, None, None, known.get(&path), times, &mut f.problems);
                f.items.extend(row);
                continue;
            }
            let meta = meta_path(&path);
            let m = match read_json(&meta) {
                Ok(m) => m,
                Err(e) => {
                    f.problems.push(format!("{}: {e}", meta.display()));
                    f.tend.tree(&path, &mut f.problems);
                    continue;
                }
            };
            let project = m
                .as_ref()
                .is_some_and(|m| m.get(TYPE_KEY).and_then(Value::as_str) == Some(PROJECT_TYPE));
            if !project {
                lib.read_group(&path, None, None, m, &mut f);
                continue;
            }
            let mut m = m.unwrap_or_default();
            let name = name_of(&path);
            let id = m
                .get(ID_KEY)
                .and_then(Value::as_str)
                .filter(|id| check_name(id).is_ok())
                .map(str::to_owned);
            let (cover, cover_mtime) = match &id {
                Some(id) => cover::read(&lib.cards_dir(id), &mut f.problems),
                None => (json!([]), 0.0),
            };
            let from = f.items.len();
            let kids = lib.read_dir(&path, Some(&name), None, &mut f);
            put_print(&meta, &mut m, kids, &mut f.problems);
            let mtime = f.items[from..].iter().map(|r| r.item.mtime).fold(
                mtime_of(&path).max(mtime_of(&meta)).max(cover_mtime),
                f64::max,
            );
            projects.push(StoredProject { name, cover, mtime });
        }
        let Found {
            items,
            mut groups,
            mut problems,
            tend,
            ..
        } = f;
        groups.sort_by(|a, b| a.dir.cmp(&b.dir));

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
        orphan::sweep(root, &mut problems);
        let orphans = tend.orphans;
        lib.orphans = orphans.clone();
        Ok((
            lib,
            Scan {
                items,
                projects,
                groups,
                state,
                tag_covers,
                orphans,
                problems,
            },
        ))
    }

    pub fn opened(&self, scan: Scan) -> Opened {
        logged(self.cache.replace(
            &scan.items,
            &scan.projects,
            &scan.groups,
            &scan.state,
            &scan.tag_covers,
        ));
        Opened {
            root: self.root.clone(),
            items: scan.items.into_iter().map(|r| r.item).collect(),
            projects: scan.projects,
            groups: scan.groups,
            state: scan.state,
            tag_covers: scan.tag_covers,
            orphans: scan.orphans,
            formats: self.plugins.formats(),
            links: self.plugins.links(),
            screens: self.plugins.screens(),
            problems: scan.problems,
        }
    }

    /// 写しを読めないときは、比べられないので何も変えずに Err を返す。
    pub fn apply(&mut self, fresh: Library, scan: Scan) -> Result<Changes, String> {
        let before = self.cache.rows()?;
        let was_projects = self.cache.projects()?;
        let was_groups = self.cache.groups()?;
        let was_state = self.cache.state()?;
        let was_covers = self.cache.tag_covers()?;
        let touched = self.touched.take().unwrap_or_default();
        let mut changes = Changes {
            problems: scan.problems,
            ..Changes::default()
        };
        if scan.orphans != self.orphans {
            self.orphans = scan.orphans.clone();
            changes.orphans = Some(scan.orphans);
        }

        let names: HashMap<String, String> = before
            .values()
            .map(|b| (b.item.id.clone(), b.item.name.clone()))
            .collect();
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
            if let Some(old) = names.get(&row.item.id)
                && *old != row.item.name
            {
                changes.renamed.insert(row.item.id.clone(), old.clone());
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
        logged(self.cache.update(&rows, &gone));

        let mut entries = fresh.entries;
        entries.retain(|_, e| !touched.contains(&e.path));
        for (id, e) in self.entries.drain() {
            if touched.contains(&e.path) {
                entries.insert(id, e);
            }
        }
        self.entries = entries;

        let was = was_projects;
        let kept = |name: &str| touched.contains(&self.root.join(name));
        let mut projects: Vec<StoredProject> = scan
            .projects
            .into_iter()
            .filter(|p| !kept(&p.name))
            .chain(was.iter().filter(|p| kept(&p.name)).cloned())
            .collect();
        projects.sort_by(|a, b| a.name.cmp(&b.name));
        if serde_json::to_value(&projects).ok() != serde_json::to_value(&was).ok() {
            logged(self.cache.replace_projects(&projects));
            changes.projects = Some(projects);
        }

        let mut was = was_groups;
        was.sort_by(|a, b| a.dir.cmp(&b.dir));
        let mut groups: Vec<StoredGroup> = scan
            .groups
            .into_iter()
            .filter(|g| !touched.contains(&g.dir))
            .chain(was.iter().filter(|g| touched.contains(&g.dir)).cloned())
            .collect();
        groups.sort_by(|a, b| a.dir.cmp(&b.dir));
        if serde_json::to_value(&groups).ok() != serde_json::to_value(&was).ok() {
            logged(self.cache.replace_groups(&groups));
            changes.groups = Some(groups);
        }

        if !touched.contains(&self.state_path())
            && serde_json::to_value(&scan.state).ok() != serde_json::to_value(was_state).ok()
        {
            logged(self.cache.put_state(&scan.state));
            changes.state = Some(scan.state);
        }

        if !touched.contains(&self.tags_dir()) && scan.tag_covers != was_covers {
            logged(self.cache.put_tag_covers(&scan.tag_covers));
            changes.tag_covers = Some(scan.tag_covers);
        }
        Ok(changes)
    }

    fn mark(&mut self, path: &Path) {
        if let Some(t) = &mut self.touched {
            t.insert(path.to_owned());
        }
    }

    /// 直下の項目とグループを読み、その ID を返す。
    fn read_dir(
        &mut self,
        dir: &Path,
        project: Option<&str>,
        group: Option<&str>,
        f: &mut Found,
    ) -> Vec<String> {
        let mut kids = Vec::new();
        for Listed {
            path,
            is_dir,
            times,
        } in list_dir(dir, f)
        {
            if is_dir {
                let m = match read_json(&meta_path(&path)) {
                    Ok(m) => m,
                    Err(e) => {
                        f.problems
                            .push(format!("{}: {e}", meta_path(&path).display()));
                        f.tend.tree(&path, &mut f.problems);
                        continue;
                    }
                };
                kids.extend(self.read_group(&path, project, group, m, f));
            } else {
                let row = self.read_item(
                    &path,
                    project,
                    group,
                    f.known.get(&path),
                    times,
                    &mut f.problems,
                );
                if let Some(r) = row {
                    kids.push(r.item.id.clone());
                    f.items.push(r);
                }
            }
        }
        kids
    }

    /// グループのフォルダを読む。.meta がなければ ID を書く。コピーで ID が重なったら、あとのほうに新しい ID を書く。
    fn read_group(
        &mut self,
        dir: &Path,
        project: Option<&str>,
        parent: Option<&str>,
        meta: Option<Map<String, Value>>,
        f: &mut Found,
    ) -> Option<String> {
        let mut m = meta.unwrap_or_default();
        let id = m
            .get(ID_KEY)
            .and_then(Value::as_str)
            .filter(|id| check_name(id).is_ok() && !f.groups.iter().any(|g| g.id == *id))
            .map(str::to_owned)
            .unwrap_or_else(|| {
                let id = new_id();
                m.insert(ID_KEY.into(), json!(id));
                m.remove(PRINT_KEY);
                id
            });
        let kind = m
            .get(TYPE_KEY)
            .and_then(Value::as_str)
            .filter(|t| *t != PROJECT_TYPE)
            .map(str::to_owned);
        let at = f.groups.len();
        f.groups.push(StoredGroup {
            id: id.clone(),
            name: name_of(dir),
            project: project.map(str::to_owned),
            parent: parent.map(str::to_owned),
            kind,
            dir: dir.to_owned(),
            mtime: 0.0,
        });
        let from = f.items.len();
        let kids = self.read_dir(dir, project, Some(&id), f);
        let meta = meta_path(dir);
        put_print(&meta, &mut m, kids, &mut f.problems);
        f.groups[at].mtime = f.items[from..]
            .iter()
            .map(|r| r.item.mtime)
            .fold(mtime_of(dir).max(mtime_of(&meta)), f64::max);
        Some(id)
    }

    pub(crate) fn read_item(
        &mut self,
        path: &Path,
        project: Option<&str>,
        group: Option<&str>,
        known: Option<&Row>,
        times: Option<(f64, f64)>,
        problems: &mut Vec<String>,
    ) -> Option<Row> {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let note = ext == NOTE_EXT;
        let sig = match times {
            Some((file, meta)) => Sig::from_times(file, meta, note),
            None => Sig::of(path, note),
        };
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
            let mut k = k.clone();
            k.item.project = project.map(str::to_owned);
            k.item.group = group.map(str::to_owned);
            return Some(k);
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
                project: project.map(str::to_owned),
                group: group.map(str::to_owned),
                tags: r.tags,
                memo: r.memo,
                aliases: r.aliases,
                body: r.body,
                mtime: mtime_of(path),
                width: None,
                height: None,
                file: path.to_owned(),
                thumb: None,
                wave_thumb: false,
                print: if note { None } else { orphan::print(path) },
            },
            saved,
            sig,
        })
    }

    /// 書き終えた項目を読み直して写しに入れる。ファイルは書けているので、写しを読めなくても失敗にはしない。
    fn refresh(&mut self, id: &str) -> Option<StoredItem> {
        let e = self.entry(id).ok()?;
        let (path, note) = (e.path.clone(), e.note);
        self.mark(&path);
        let mut row = self
            .cache
            .row(&path)
            .inspect_err(|e| log::warn!("{e}"))
            .ok()??;
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
        logged(self.cache.update(std::slice::from_ref(&row), &[]));
        Some(row.item)
    }

    pub(crate) fn remember(&mut self, row: &Row) {
        self.mark(&row.item.file);
        logged(self.cache.update(std::slice::from_ref(row), &[]));
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
        let (path, ext, note) = self.file(id)?;
        if note {
            return Err(format!("ID「{id}」はノートのため、素材として扱えません"));
        }
        Ok((path, ext))
    }

    /// 覚えている項目の情報。
    pub fn stored(&self, id: &str) -> Result<Option<StoredItem>, String> {
        let Ok(e) = self.entry(id) else {
            return Ok(None);
        };
        Ok(self.cache.row(&e.path)?.map(|r| r.item))
    }

    /// 素材とノートのパス・拡張子（小文字）・ノートか。
    pub fn file(&self, id: &str) -> Result<(&Path, String, bool), String> {
        let e = self.entry(id)?;
        let ext = e
            .path
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_lowercase();
        Ok((&e.path, ext, e.note))
    }

    pub fn save_item(&mut self, id: &str, patch: &ItemPatch) -> Result<Option<StoredItem>, String> {
        let e = self.entry(id)?;
        let (path, note) = (e.path.clone(), e.note);
        let changed = patch.has_text()
            && self
                .cache
                .row(&path)?
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

    pub fn move_item(&mut self, id: &str, place: &Place) -> Result<StoredItem, String> {
        // 生成物は ID で引くので、ID をメタ情報に書いてから動かす
        self.ensure_saved(id)?;
        let from = self.entry(id)?.path.clone();
        let row = self.row_of(&from)?;
        let (dir, project, group) = self.place_dir(place)?;
        if row.item.project == project && row.item.group == group {
            return Ok(row.item);
        }
        let name = from.file_name().ok_or("ファイル名がありません")?;
        let taken = format!(
            "「{}」に同じ名前のファイル（{}）があるため、移動できません",
            self.place_name(&dir),
            name.to_string_lossy()
        );
        let to = dir.join(name);
        let it = self.relocate(id, row, &to, taken, |it| {
            (it.project, it.group) = (project, group);
        })?;
        self.reprint([from.parent().unwrap_or(&self.root).to_owned(), dir]);
        Ok(it)
    }

    /// 置き場所のフォルダと、そこに置いた素材の project・group。
    pub(crate) fn place_dir(
        &self,
        place: &Place,
    ) -> Result<(PathBuf, Option<String>, Option<String>), String> {
        if let Some(id) = &place.group {
            let g = self
                .cache
                .group(id)?
                .ok_or_else(|| format!("ID「{id}」のグループが見つかりません"))?;
            if !g.dir.is_dir() {
                return Err(format!("グループ「{}」が見つかりません", g.name));
            }
            return Ok((g.dir, g.project, Some(g.id)));
        }
        match &place.project {
            Some(p) => {
                let d = self.project_dir(p)?;
                if !d.is_dir() {
                    return Err(format!("プロジェクト「{p}」が見つかりません"));
                }
                Ok((d, Some(p.clone()), None))
            }
            None => Ok((self.root.clone(), None, None)),
        }
    }

    pub(crate) fn place_name(&self, dir: &Path) -> String {
        if dir == self.root {
            "所属なし".into()
        } else {
            name_of(dir)
        }
    }

    /// 直下が変わったフォルダの照合用の値を、裏で書き直す。
    pub(crate) fn reprint(&self, dirs: impl IntoIterator<Item = PathBuf>) {
        orphan::queue_reprint(dirs.into_iter().filter(|d| *d != self.root).collect());
    }

    pub fn rename_item(&mut self, id: &str, name: &str) -> Result<StoredItem, String> {
        if name.trim().is_empty() {
            return Err("名前を入れてください".into());
        }
        // 「.」で始まるファイルは、隠しファイルとして読まれなくなる
        if name.starts_with('.') || bad_chars(name) {
            return Err(unusable(name));
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
        // 拡張子が後ろに付かないと、末尾の空白と「.」は Windows で落ち、.meta で終わるものはメタ情報のファイルと見分けられなくなる
        if (from.extension().is_none() && name.ends_with(['.', ' ']))
            || file.to_ascii_lowercase().ends_with(".meta")
        {
            return Err(unusable(name));
        }
        let to = from.with_file_name(&file);
        let taken = format!("同じ名前のファイル（{file}）があるため、名前を変えられません");
        self.relocate(id, row, &to, taken, |it| it.name = name.to_owned())
    }

    /// 素材の中身を from のファイルに置き換える。拡張子は from に合わせ、元のファイルは残さない。
    pub fn replace_file(&mut self, id: &str, from: &Path) -> Result<StoredItem, String> {
        // 生成物は ID で引くので、ID をメタ情報に書いてから動かす
        self.ensure_saved(id)?;
        let e = self.entry(id)?;
        if e.note {
            return Err("ノートの中身は置き換えられません".into());
        }
        let path = e.path.clone();
        let row = self.row_of(&path)?;
        let ext = from
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let to = path.with_extension(&ext);
        if to != path {
            let file = to.file_name().unwrap_or_default().to_string_lossy();
            let taken = format!("同じ名前のファイル（{file}）があるため、置き換えられません");
            self.relocate(id, row, &to, taken, |it| {
                it.ext.clone_from(&ext);
                (it.thumb, it.width, it.height) = (None, None, None);
            })?;
        }
        fs::copy(from, &to).map_err(|e| format!("{}: {e}", to.display()))?;
        self.refresh(id)
            .ok_or_else(|| format!("{} を読み直せません", to.display()))
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
        self.reprint(path.parent().map(Path::to_owned));
        logged(self.cache.update(&[], &[path]));
        Ok(())
    }

    fn row_of(&self, path: &Path) -> Result<Row, String> {
        self.cache
            .row(path)?
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
        let reads = self.cache.thumb_read(&from)?.unwrap_or_default();
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
        row.item.file = to.to_owned();
        change(&mut row.item);
        logged(self.cache.update(std::slice::from_ref(&row), &[from]));
        if let Some(t) = &row.item.thumb {
            let size = row.item.width.zip(row.item.height).unwrap_or_default();
            logged(self.cache.set_thumb(to, t, size, &reads));
        }
        Ok(row.item)
    }

    /// ノートのリンクの表示名を、リンク先のいまの名前に書き換える。書き換えたノートを返す。
    /// renamed は、名前を変えたものの ID と前の名前。
    pub fn sync_link_names(&mut self, renamed: &HashMap<String, String>) -> Vec<StoredItem> {
        if renamed.is_empty() {
            return Vec::new();
        }
        let now: Vec<(&str, &str, String)> = renamed
            .iter()
            .filter_map(|(id, old)| {
                let it = self.stored(id).inspect_err(|e| log::warn!("{e}")).ok()??;
                Some((id.as_str(), old.as_str(), it.name))
            })
            .collect();
        let names: HashMap<&str, (&str, &str)> = now
            .iter()
            .map(|(id, old, new)| (*id, (*old, new.as_str())))
            .collect();
        let rows = match self.cache.note_rows() {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("{e}");
                return Vec::new();
            }
        };
        // 外で変わったまま読み直していないものは、読み直したあとに回す。更新日時は、書き換えの要るものだけ確かめる
        let stale: Vec<(String, String)> = rows
            .values()
            .filter_map(|r| {
                let body = r.item.body.as_deref()?;
                let new = note::rename_links(body, |id| names.get(id).copied())?;
                (r.sig == Sig::of(&r.item.file, true)).then(|| (r.item.id.clone(), new))
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
                        self.cache.row(&path).ok().flatten().map(|r| r.item)
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
        logged(self.cache.put_state(state));
        Ok(())
    }

    pub fn tag_history(&self) -> Result<Vec<String>, String> {
        let m = read_json(&self.root.join(STATE_DIR).join(TAG_HISTORY))?;
        Ok(strings(m.as_ref().and_then(|m| m.get("tags"))))
    }

    pub fn save_tag_history(&mut self, tags: &[String]) -> Result<(), String> {
        let dir = self.root.join(STATE_DIR);
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let path = dir.join(TAG_HISTORY);
        write_json(&path, &Map::from_iter([("tags".to_owned(), json!(tags))]))?;
        self.mark(&path);
        Ok(())
    }

    pub fn open_history(&self) -> Result<Vec<String>, String> {
        let m = read_json(&self.root.join(STATE_DIR).join(OPEN_HISTORY))?;
        Ok(strings(m.as_ref().and_then(|m| m.get("items"))))
    }

    pub fn save_open_history(&mut self, ids: &[String]) -> Result<(), String> {
        let dir = self.root.join(STATE_DIR);
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let path = dir.join(OPEN_HISTORY);
        write_json(&path, &Map::from_iter([("items".to_owned(), json!(ids))]))?;
        self.mark(&path);
        Ok(())
    }

    /// 開いていたタブ。中身は画面側が決めるので、そのまま渡す
    pub fn tabs(&self) -> Result<Option<Map<String, Value>>, String> {
        read_json(&self.root.join(STATE_DIR).join(TABS))
    }

    pub fn save_tabs(&mut self, tabs: &Map<String, Value>) -> Result<(), String> {
        let dir = self.root.join(STATE_DIR);
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let path = dir.join(TABS);
        write_json(&path, tabs)?;
        self.mark(&path);
        Ok(())
    }

    fn project_dir(&self, name: &str) -> Result<PathBuf, String> {
        check_name(name)?;
        Ok(self.root.join(name))
    }

    pub fn create_note(&mut self, name: &str, place: &Place) -> Result<StoredItem, String> {
        check_name(name)?;
        let (dir, project, group) = self.place_dir(place)?;
        // 画面の知らないファイルがあっても作れるよう、かぶったら番号を付ける
        let name = numbered(name, |n| dir.join(format!("{n}.{NOTE_EXT}")).exists());
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
            project,
            group,
            tags: vec![],
            memo: String::new(),
            aliases: Some(vec![]),
            body: Some(String::new()),
            mtime: mtime_of(&path),
            width: None,
            height: None,
            file: path.clone(),
            thumb: None,
            wave_thumb: false,
            print: None,
        };
        self.remember(&Row {
            item: item.clone(),
            saved: true,
            sig: Sig::of(&path, true),
        });
        self.reprint([dir]);
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
        m.insert(TYPE_KEY.into(), json!(PROJECT_TYPE));
        m.insert(PRINT_KEY.into(), json!(orphan::group_print(vec![])));
        write_json(&meta, &m)?;
        let p = StoredProject {
            name: name.to_owned(),
            cover: json!([]),
            mtime: mtime_of(&meta),
        };
        self.mark(&dir);
        logged(self.cache.put_project(&p));
        Ok(p)
    }

    /// place の中にグループのフォルダを作る。同じ名前があれば番号を付ける。
    pub(crate) fn create_group(
        &mut self,
        base: &str,
        place: &Place,
    ) -> Result<StoredGroup, String> {
        check_name(base)?;
        let (parent, project, group) = self.place_dir(place)?;
        let name = numbered(base, |n| {
            let d = parent.join(n);
            d.exists() || meta_path(&d).exists()
        });
        let dir = parent.join(&name);
        fs::create_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let id = new_id();
        let meta = meta_path(&dir);
        let mut m = Map::new();
        m.insert(ID_KEY.into(), json!(id));
        m.insert(PRINT_KEY.into(), json!(orphan::group_print(vec![])));
        write_json(&meta, &m)?;
        let g = StoredGroup {
            id,
            name,
            project,
            parent: group,
            kind: None,
            dir: dir.clone(),
            mtime: mtime_of(&meta),
        };
        self.mark(&dir);
        logged(self.cache.put_group(&g));
        self.reprint([parent]);
        Ok(g)
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
        logged(self.cache.projects().and_then(|ps| {
            let Some(mut p) = ps.into_iter().find(|p| p.name == name) else {
                return Ok(());
            };
            p.cover = cover;
            p.mtime = p.mtime.max(mtime_of(&cards.join(cover::LAYOUT)));
            self.cache.put_project(&p)
        }));
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
        self.edit_covers(|mut c| {
            c.insert(tag.to_owned(), cover);
            c
        });
        Ok(())
    }

    /// 下の階層のタグも合わせて、項目と概要を付け替える。変えた先の名前がすでにあれば、keep_from のときは元の概要を、
    /// そうでなければ変えた先の概要を残し、残さないほうのカードはごみ箱に移す。
    pub fn rename_tag(&mut self, from: &str, to: &str, keep_from: bool) -> Result<(), String> {
        let re = |t: &str| {
            if t == from {
                Some(to.to_owned())
            } else {
                t.strip_prefix(from)
                    .filter(|rest| rest.starts_with('/'))
                    .map(|rest| format!("{to}{rest}"))
            }
        };
        let retagged: Vec<(String, ListDiff)> = self
            .cache
            .rows()?
            .into_values()
            .filter_map(|r| {
                let old = r.item.tags;
                let mut next: Vec<String> = Vec::new();
                for t in &old {
                    let t = re(t).unwrap_or_else(|| t.clone());
                    if !next.contains(&t) {
                        next.push(t);
                    }
                }
                (next != old).then(|| {
                    let diff = ListDiff {
                        add: next.iter().filter(|t| !old.contains(t)).cloned().collect(),
                        remove: old.iter().filter(|t| !next.contains(t)).cloned().collect(),
                    };
                    (r.item.id, diff)
                })
            })
            .collect();
        let mut failed = Vec::new();
        for (id, diff) in retagged {
            let patch = ItemPatch {
                tags: Some(diff),
                ..ItemPatch::default()
            };
            if let Err(e) = self.save_item(&id, &patch) {
                failed.push(e);
            }
        }
        self.rename_tag_covers(&re, keep_from)?;
        match failed.first() {
            Some(e) => Err(format!(
                "{} 件の素材のタグを変えられませんでした：{e}",
                failed.len()
            )),
            None => Ok(()),
        }
    }

    fn rename_tag_covers(
        &mut self,
        re: &dyn Fn(&str) -> Option<String>,
        keep_from: bool,
    ) -> Result<(), String> {
        let rekey = |m: Map<String, Value>| {
            let (moved, kept): (Vec<_>, Vec<_>) = m.into_iter().partition(|(t, _)| re(t).is_some());
            let mut next: Map<String, Value> = kept.into_iter().collect();
            let mut lost = Vec::new();
            for (t, v) in moved {
                let t = re(&t).unwrap_or(t);
                if next.contains_key(&t) && !keep_from {
                    lost.push(v);
                } else {
                    lost.extend(next.insert(t, v));
                }
            }
            (next, lost)
        };
        let dir = self.tags_dir();
        let index_path = dir.join(TAG_INDEX);
        let Some(index) = read_json(&index_path)? else {
            return Ok(());
        };
        let (next, lost) = rekey(index.clone());
        if next == index {
            return Ok(());
        }
        write_json(&index_path, &next)?;
        let gone: Vec<PathBuf> = lost
            .iter()
            .filter_map(Value::as_str)
            .filter(|id| check_name(id).is_ok())
            .map(|id| dir.join(id))
            .filter(|d| d.is_dir())
            .collect();
        if !gone.is_empty() {
            trash::delete_all(&gone).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        self.mark(&dir);
        self.edit_covers(|c| rekey(c).0);
        Ok(())
    }

    pub fn delete_tag_cover(&mut self, tag: &str) -> Result<(), String> {
        let dir = self.tags_dir();
        let index_path = dir.join(TAG_INDEX);
        let mut index = read_json(&index_path)?.unwrap_or_default();
        let Some(id) = index.remove(tag) else {
            return Ok(());
        };
        write_json(&index_path, &index)?;
        if let Some(cards) = id
            .as_str()
            .filter(|id| check_name(id).is_ok())
            .map(|id| dir.join(id))
            .filter(|d| d.is_dir())
        {
            trash::delete(&cards).map_err(|e| format!("{}: {e}", cards.display()))?;
        }
        self.mark(&dir);
        self.edit_covers(|mut c| {
            c.remove(tag);
            c
        });
        Ok(())
    }

    /// 写しのタグの概要を書き換える。ファイルは書けているので、写しを読み書きできなくても失敗にはしない。
    fn edit_covers(&self, f: impl FnOnce(Map<String, Value>) -> Map<String, Value>) {
        logged(
            self.cache
                .tag_covers()
                .and_then(|c| self.cache.put_tag_covers(&f(c))),
        );
    }

    /// フォルダと .meta の名前を変える。中の項目は、次に突き合わせたときに読み直す。
    pub fn rename_project(&mut self, from: &str, to: &str) -> Result<(), String> {
        let (dir, target) = (self.project_dir(from)?, self.project_dir(to)?);
        if !dir.is_dir() {
            return Err(format!("プロジェクト「{from}」が見つかりません"));
        }
        if target.exists() || meta_path(&target).exists() {
            return Err(format!("「{to}」はすでに存在します"));
        }
        fs::rename(&dir, &target).map_err(|e| format!("{}: {e}", dir.display()))?;
        let meta = meta_path(&dir);
        if meta.exists()
            && let Err(e) = fs::rename(&meta, meta_path(&target))
        {
            let _ = fs::rename(&target, &dir);
            return Err(format!("{}: {e}", meta.display()));
        }
        Ok(())
    }

    /// 中のファイルとフォルダをルートの直下に移し、残ったフォルダと .meta、概要のカードをごみ箱に移す。
    /// ルートに同じ名前があれば、番号を付けて移す。中の項目は、次に突き合わせたときに読み直す。
    pub fn delete_project(&mut self, name: &str) -> Result<(), String> {
        let dir = self.project_dir(name)?;
        if !dir.is_dir() {
            return Err(format!("プロジェクト「{name}」が見つかりません"));
        }
        let rd = read_entries(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
        let mut put = |from: PathBuf, to: PathBuf| match fs::rename(&from, &to) {
            Ok(()) => {
                moved.push((from, to));
                Ok(())
            }
            Err(e) => Err(format!("{}: {e}", from.display())),
        };
        let mut failed = None;
        for DirItem { entry: e, .. } in rd.into_iter().filter(listed_entry) {
            let from = e.path();
            let to = free_path(&self.root, &e.file_name(), from.is_dir());
            let meta = meta_path(&from);
            let r = put(from, to.clone()).and_then(|()| {
                if meta.exists() {
                    put(meta, meta_path(&to))
                } else {
                    Ok(())
                }
            });
            if let Err(e) = r {
                failed = Some(e);
                break;
            }
        }
        let r = match failed {
            Some(e) => Err(e),
            None => self.trash_project(&dir),
        };
        if r.is_err() {
            for (from, to) in moved.into_iter().rev() {
                let _ = fs::rename(&to, &from);
            }
        }
        r
    }

    fn trash_project(&self, dir: &Path) -> Result<(), String> {
        let meta = meta_path(dir);
        let mut gone = vec![dir.to_owned()];
        let cards = read_json(&meta)?
            .as_ref()
            .and_then(|m| m.get(ID_KEY))
            .and_then(Value::as_str)
            .filter(|id| check_name(id).is_ok())
            .map(|id| self.cards_dir(id))
            .filter(|d| d.is_dir());
        gone.extend(cards);
        if meta.exists() {
            gone.push(meta);
        }
        trash::delete_all(&gone).map_err(|e| format!("{}: {e}", dir.display()))
    }

    fn orphan(&self, meta: &Path) -> Result<Orphan, String> {
        self.orphans
            .iter()
            .find(|o| o.meta == meta)
            .cloned()
            .ok_or_else(|| format!("{} が見つかりません", meta.display()))
    }

    pub fn relink_meta(&mut self, meta: &Path, to: &str) -> Result<(), String> {
        orphan::relink_to(&self.root, &self.orphan(meta)?, to)
    }

    pub fn discard_meta(&mut self, meta: &Path) -> Result<(), String> {
        orphan::discard(&self.root, &self.orphan(meta)?)
    }
}

/// dir の中で、その名前も .meta もまだ使われていないパス。かぶれば番号を付ける。
fn free_path(dir: &Path, name: &OsStr, is_dir: bool) -> PathBuf {
    let p = Path::new(name);
    let (stem, ext) = match (is_dir, p.file_stem(), p.extension()) {
        (false, Some(s), Some(e)) => (
            s.to_string_lossy().into_owned(),
            format!(".{}", e.to_string_lossy()),
        ),
        _ => (name.to_string_lossy().into_owned(), String::new()),
    };
    dir.join(
        numbered(&stem, |n| {
            let to = dir.join(format!("{n}{ext}"));
            to.exists() || meta_path(&to).exists()
        }) + &ext,
    )
}

/// base が使われていれば、使われていない名前になるまで「base 2」「base 3」と番号を付ける。
/// 写しに書けなかったことを残す。読んだものやファイルは正しいので、処理は続ける（写しは次に確かめるときに書き直す）。
fn logged(r: Result<(), String>) {
    if let Err(e) = r {
        log::warn!("{e}");
    }
}

pub(crate) fn numbered(base: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut name = base.to_owned();
    for n in 2.. {
        if !taken(&name) {
            break;
        }
        name = format!("{base} {n}");
    }
    name
}

/// プロジェクトの概要のカードを置くフォルダ。
pub(crate) fn cards_dir(root: &Path, id: &str) -> PathBuf {
    root.join(STATE_DIR).join(PROJECTS_DIR).join(id)
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
fn hidden_meta(m: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    m.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(target_os = "macos")]
fn hidden_meta(m: &fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    const UF_HIDDEN: u32 = 0x8000;
    m.st_flags() & UF_HIDDEN != 0
}

/// Linux などには隠す属性がなく、名前が「.」で始まるものだけが隠しファイル。
#[cfg(not(any(windows, target_os = "macos")))]
fn hidden_meta(_: &fs::Metadata) -> bool {
    false
}

const HAS_HIDDEN: bool = cfg!(any(windows, target_os = "macos"));

fn hidden(path: &Path) -> bool {
    HAS_HIDDEN && fs::metadata(path).is_ok_and(|m| hidden_meta(&m))
}

struct Found<'a> {
    known: &'a HashMap<PathBuf, Row>,
    tend: orphan::Tend<'a>,
    items: Vec<Row>,
    groups: Vec<StoredGroup>,
    problems: Vec<String>,
}

pub(crate) fn name_of(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

/// 直下の ID から作った照合用の値を、変わっていれば .meta に書く。
fn put_print(
    meta: &Path,
    m: &mut Map<String, Value>,
    kids: Vec<String>,
    problems: &mut Vec<String>,
) {
    let print = json!(orphan::group_print(kids));
    if m.get(PRINT_KEY) == Some(&print) && meta.exists() {
        return;
    }
    m.insert(PRINT_KEY.into(), print);
    if let Err(e) = write_json(meta, m) {
        problems.push(format!("{}: {e}", meta.display()));
    }
}

pub(crate) fn listed(path: &Path) -> bool {
    let n = path.file_name().unwrap_or_default().to_string_lossy();
    !n.starts_with('.') && !n.ends_with(".meta") && !hidden(path)
}

/// フォルダの中の 1 件と、その属性（リンクならリンクそのもの）。
pub(crate) struct DirItem {
    pub entry: fs::DirEntry,
    pub meta: Option<fs::Metadata>,
}

/// フォルダを読み、属性も 1 件に 1 度だけ取る。Windows ではフォルダを読んだときに届いたものを使う。
pub(crate) fn read_entries(dir: &Path) -> std::io::Result<Vec<DirItem>> {
    Ok(fs::read_dir(dir)?
        .filter_map(Result::ok)
        .map(|entry| DirItem {
            meta: entry.metadata().ok(),
            entry,
        })
        .collect())
}

/// listed と同じ判定を、フォルダを読んだときに取れた属性で行う。
pub(crate) fn listed_entry(e: &DirItem) -> bool {
    let n = e.entry.file_name();
    let n = n.to_string_lossy();
    !n.starts_with('.') && !n.ends_with(".meta") && !hidden_entry(e)
}

fn hidden_entry(e: &DirItem) -> bool {
    if !HAS_HIDDEN {
        return false;
    }
    match &e.meta {
        // リンクは、たどった先の属性で決める
        Some(m) if !m.file_type().is_symlink() => hidden_meta(m),
        _ => hidden(&e.entry.path()),
    }
}

struct Listed {
    path: PathBuf,
    is_dir: bool,
    /// ファイルと .meta の更新日時。リンクで取れないときは None
    times: Option<(f64, f64)>,
}

fn entry_mtime(e: &DirItem) -> Option<f64> {
    let m = e.meta.as_ref().filter(|m| !m.file_type().is_symlink())?;
    Some(
        m.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0.0, |d| d.as_millis() as f64),
    )
}

/// フォルダの中身を並べる。読んだついでに、そのフォルダの .meta をつなぎ直し、持ち主のないものを探す。
fn list_dir(dir: &Path, f: &mut Found) -> Vec<Listed> {
    let read = read_entries(dir).and_then(|entries| {
        if crate::library::import::recover(dir, &entries, &mut f.problems) {
            read_entries(dir)
        } else {
            Ok(entries)
        }
    });
    let entries = match read {
        Ok(entries) => f.tend.visit(dir, entries, &mut f.problems),
        Err(e) => {
            f.problems.push(format!("{}: {e}", dir.display()));
            return vec![];
        }
    };
    let times: HashMap<OsString, Option<f64>> = entries
        .iter()
        .map(|e| (e.entry.file_name(), entry_mtime(e)))
        .collect();
    let mut out: Vec<Listed> = entries
        .iter()
        .filter(|e| listed_entry(e))
        .map(
            |DirItem {
                 entry: e,
                 meta: attrs,
             }| {
                let name = e.file_name();
                let mut meta = name.clone();
                meta.push(".meta");
                let meta = match times.get(&meta) {
                    Some(t) => *t,
                    None => Some(0.0),
                };
                Listed {
                    path: e.path(),
                    is_dir: attrs.as_ref().map_or_else(
                        || e.file_type().is_ok_and(|t| t.is_dir()),
                        |m| m.file_type().is_dir(),
                    ),
                    times: times.get(&name).copied().flatten().zip(meta),
                }
            },
        )
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
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
