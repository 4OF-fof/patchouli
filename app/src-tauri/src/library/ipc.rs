use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::ai::content;
use crate::background;
use crate::library::cache::{self, Cache};
use crate::library::{
    self, ItemPatch, Library, LibraryState, Opened, Place, StoredItem, StoredProject, import,
};
use crate::plugin::ipc::{dev_places, plugin_dir, plugin_ids};
use crate::plugin::{HookEvent, Registry, Runner, hooks};
use crate::session::{
    Current, Session, cache_dir, library_root, next_session, root_of, with, with_session,
};
use crate::shell::settings;
use crate::thumb;
use crate::thumb::ipc::{make_thumbs, plan_thumbs, spawn_thumbs};

/// 開いているライブラリのロック。ほかのアプリが同じライブラリを開いて、キャッシュやメタ情報を書き合わないようにする。
static LOCKED: Mutex<Option<(PathBuf, std::fs::File)>> = Mutex::new(None);

fn lock_library(root: &Path) -> Result<(), String> {
    let mut held = LOCKED.lock().unwrap_or_else(|e| e.into_inner());
    if held.as_ref().is_some_and(|(r, _)| r == root) {
        return Ok(());
    }
    let dir = root.join(library::STATE_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("lock");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    match file.try_lock() {
        Ok(()) => {
            *held = Some((root.to_owned(), file));
            Ok(())
        }
        Err(std::fs::TryLockError::WouldBlock) => Err(format!(
            "このライブラリ（{}）は別のウィンドウで開いています",
            root.display()
        )),
        Err(std::fs::TryLockError::Error(e)) => Err(format!("{}: {e}", path.display())),
    }
}

#[tauri::command]
pub(crate) async fn open_library(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<Opened, String> {
    let root = library::canonical(&library_root(&app)?)?;
    lock_library(&root)?;
    let (plugins, plugin_problems) =
        Registry::open(&root, &plugin_dir(&app, &root)?, dev_places(&app).as_ref());
    let plugins = Arc::new(plugins);
    if let Err(e) = settings::remember(&app, &root, plugin_ids(&root).unwrap_or_default()) {
        log::warn!("開いたライブラリを覚えられない: {e}");
    }
    let cache_dir = cache_dir(&app)?;
    let cache_path = cache::path_for(&cache_dir, &root);
    cache::touch(&cache_path);
    let cache = Arc::new(Cache::open(&cache_path));
    {
        let (dir, root) = (cache_dir.clone(), root.clone());
        background::spawn(move || cache::sweep(&dir, &root));
    }
    let thumbs = thumb::dir_for(&cache_dir, &root);
    std::fs::create_dir_all(&thumbs).map_err(|e| format!("{}: {e}", thumbs.display()))?;
    let scope = app.asset_protocol_scope();
    for dir in [&root, &thumbs] {
        scope
            .allow_directory(dir, true)
            .map_err(|e| e.to_string())?;
    }
    let (lib, mut opened, checking) =
        match Library::cached(&root, Arc::clone(&plugins), Arc::clone(&cache)) {
            Some((lib, opened)) => (lib, opened, true),
            None => {
                let since = std::time::SystemTime::now();
                let (lib, mut scan) =
                    Library::scan(&root, Arc::clone(&plugins), Arc::clone(&cache))?;
                let thumbs_job = plan_thumbs(
                    &plugins,
                    &thumbs,
                    &cache,
                    scan.items.iter_mut().map(|r| &mut r.item),
                );
                let all_found = thumbs_job.2 && scan.problems.is_empty();
                let opened = lib.opened(scan);
                spawn_thumbs(
                    &app, &plugins, &cache, &thumbs, thumbs_job, all_found, since,
                );
                (lib, opened, false)
            }
        };
    opened.problems.extend(plugin_problems);
    let runner = Arc::new(Mutex::new(Runner::new(Arc::clone(&plugins))));
    let id = next_session();
    *cur.lock() = Some(Session {
        id,
        lib,
        thumbs: thumbs.clone(),
        plugins: Arc::clone(&plugins),
        runner,
        ui_reads: HashMap::new(),
        latest: HashMap::new(),
    });
    // キャッシュから開いたときは、確かめ終えてから作る
    if !checking && settings::auto_tag(&app).unwrap_or(false) {
        content::collect(&app, &plugins, &opened.items, &thumbs);
    }
    if checking {
        CHECKING.fetch_add(1, Ordering::Relaxed);
        background::spawn(move || {
            check(&app, id, &root, &plugins, &cache, &thumbs);
            CHECKING.fetch_sub(1, Ordering::Relaxed);
        });
    }
    Ok(opened)
}

static CHECKING: AtomicUsize = AtomicUsize::new(0);

#[tauri::command]
pub(crate) fn checking() -> bool {
    CHECKING.load(Ordering::Relaxed) > 0
}

pub(crate) fn check(
    app: &tauri::AppHandle,
    id: u64,
    root: &Path,
    plugins: &Arc<Registry>,
    cache: &Arc<Cache>,
    thumbs: &Path,
) {
    let since = std::time::SystemTime::now();
    let (fresh, mut scan) = match Library::scan(root, Arc::clone(plugins), Arc::clone(cache)) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("ライブラリを確かめられない: {e}");
            return;
        }
    };
    // サムネイルは取り込んだときに作る。アプリの外で足された画像は、見つけた時点で取り込んだものとみなす
    let job = plan_thumbs(
        plugins,
        thumbs,
        cache,
        scan.items.iter_mut().map(|r| &mut r.item),
    );
    let all_found = job.2 && scan.problems.is_empty();
    let cur = app.state::<Current>();
    let changes = {
        let mut g = cur.lock();
        match g.as_mut() {
            Some(s) if s.id == id => {
                let mut changes = match s.lib.apply(fresh, scan) {
                    Ok(changes) => changes,
                    Err(e) => {
                        log::warn!("ライブラリを確かめられない: {e}");
                        return;
                    }
                };
                for it in s.lib.sync_link_names(&changes.renamed) {
                    changes.items.retain(|x| x.id != it.id);
                    changes.items.push(it);
                }
                changes
            }
            _ => return,
        }
    };
    // 何もないのに送ると、画面がライブラリを作り直してしまう
    if !changes.is_empty() {
        let _ = app.emit("library-changed", &changes);
    }
    hooks::queue(app, HookEvent::Changed, &changes.changed_files);
    let items = settings::auto_tag(app)
        .unwrap_or(false)
        .then(|| {
            with_session(&cur, |s| {
                (s.id == id)
                    .then(|| s.lib.snapshot().map(|o| o.items))
                    .transpose()
            })
        })
        .and_then(Result::ok)
        .flatten();
    if let Some(items) = items {
        content::collect(app, plugins, &items, thumbs);
    }
    spawn_thumbs(app, plugins, cache, thumbs, job, all_found, since);
}

#[tauri::command]
pub(crate) async fn inspect_drop(
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
) -> Result<import::DropInfo, String> {
    let root = with_session(&cur, |s| Ok(s.lib.root().to_owned())).ok();
    Ok(import::inspect(&paths, root.as_deref()))
}

/// ファイルのコピーはロックの外で行い、ロックは置き場所を決めるときと、項目を覚えるときだけ取る。
pub(crate) fn import_paths(
    cur: &State<Current>,
    paths: &[PathBuf],
    place: &Place,
    mv: bool,
) -> Result<import::Imported, String> {
    let root = with_session(cur, |s| Ok(s.lib.root().to_owned()))?;
    let found = import::gather(paths, &root);
    let mut plan = with_session(cur, |s| s.lib.plan_import(found, place))?;
    let mut staged = import::stage(&mut plan, mv);
    let r = with_session(cur, |s| s.lib.finish_import(plan, &mut staged, mv));
    import::unstage(staged, mv);
    r
}

#[tauri::command]
pub(crate) async fn import_files(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
    place: Place,
) -> Result<import::Imported, String> {
    let mv = settings::app_settings(&app)?.import_mode == settings::ImportMode::Move;
    let mut out = import_paths(&cur, &paths, &place, mv)?;
    let (thumbs, plugins, cache) = with_session(&cur, |s| {
        Ok((s.thumbs.clone(), Arc::clone(&s.plugins), s.lib.cache()))
    })?;
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut out.items);
    hooks::queue_items(&app, HookEvent::Added, &out.items);
    if !jobs.is_empty() {
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    Ok(out)
}

#[tauri::command]
pub(crate) async fn import_data(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<StoredItem, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("リクエスト本文がファイルの中身ではありません".into());
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let meta: (String, Place) = head("meta")
        .map(serde_json::from_str)
        .ok_or("ファイル名が指定されていません")?
        .map_err(|e| format!("meta の読み込みに失敗しました：{e}"))?;
    let (name, place) = meta;
    let (item, thumbs, plugins, cache) = with_session(&cur, |s| {
        Ok((
            s.lib.import_data(&name, bytes, &place)?,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
        ))
    })?;
    let mut items = vec![item];
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut items);
    hooks::queue_items(&app, HookEvent::Added, &items);
    if !jobs.is_empty() {
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    items.pop().ok_or_else(|| "取り込みに失敗しました".into())
}

#[tauri::command]
pub(crate) async fn choose_library(app: tauri::AppHandle) -> Result<bool, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("ライブラリのフォルダを選択")
        .blocking_pick_folder()
    else {
        return Ok(false);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err(format!("{} はフォルダではありません", dir.display()));
    }
    settings::set_library(&app, &dir)?;
    Ok(true)
}

#[derive(Serialize)]
pub(crate) struct KnownLibrary {
    path: PathBuf,
    name: String,
    opened: f64,
    exists: bool,
    current: bool,
}

#[tauri::command]
pub(crate) async fn libraries(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<Vec<KnownLibrary>, String> {
    let current = root_of(&cur).ok();
    Ok(settings::recent(&app)?
        .into_iter()
        .map(|r| KnownLibrary {
            name: r.path.file_name().map_or_else(
                || r.path.to_string_lossy().into_owned(),
                |n| n.to_string_lossy().into_owned(),
            ),
            exists: r.path.is_dir(),
            current: current.as_deref() == Some(r.path.as_path()),
            opened: r.opened,
            path: r.path,
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn switch_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{} が見つかりません", path.display()));
    }
    settings::set_library(&app, &path)
}

#[tauri::command]
pub(crate) async fn forget_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    settings::forget(&app, &path)
}

#[tauri::command]
pub(crate) async fn save_item(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    patch: ItemPatch,
) -> Result<Option<StoredItem>, String> {
    let read = with(&cur, |l| l.save_item(&id, &patch))?;
    if patch
        .tags
        .as_ref()
        .is_some_and(|d| !d.add.is_empty() || !d.remove.is_empty())
    {
        hooks::queue(&app, HookEvent::Edited, std::slice::from_ref(&id));
    }
    if patch.url.is_some() {
        relinked(&app, &cur, &id)?;
    }
    Ok(read)
}

/// ショートカットのリンク先を変えたら、サムネイルを作り直して画面に知らせる。
pub(crate) fn relinked(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    id: &str,
) -> Result<(), String> {
    let (item, thumbs, plugins, cache) = with_session(cur, |s| {
        Ok((
            s.lib.stored(id)?,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
        ))
    })?;
    let Some(item) = item.filter(|it| it.ext == library::shortcut::EXT) else {
        return Ok(());
    };
    let mut items = vec![item];
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut items);
    let changes = library::Changes {
        items,
        ..library::Changes::default()
    };
    let _ = app.emit("library-changed", &changes);
    if !jobs.is_empty() {
        let app = app.clone();
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn move_item(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    place: Place,
) -> Result<StoredItem, String> {
    let (it, moved) = with(&cur, |l| {
        let was = l.stored(&id)?.map(|it| (it.project, it.group));
        let it = l.move_item(&id, &place)?;
        let moved = was.is_none_or(|(p, g)| p != it.project || g != it.group);
        Ok((it, moved))
    })?;
    if moved {
        hooks::queue(&app, HookEvent::Edited, std::slice::from_ref(&id));
    }
    Ok(it)
}

#[tauri::command]
pub(crate) async fn rename_item(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    name: String,
) -> Result<StoredItem, String> {
    let (it, old, renamed) = with(&cur, |l| {
        let old = l.stored(&id)?.map(|it| it.name).unwrap_or_default();
        let it = l.rename_item(&id, &name)?;
        let renamed = l.sync_link_names(&HashMap::from([(id.clone(), old.clone())]));
        Ok((it, old, renamed))
    })?;
    if !renamed.is_empty() {
        let changes = library::Changes {
            items: renamed,
            ..library::Changes::default()
        };
        let _ = app.emit("library-changed", &changes);
    }
    if old != it.name {
        hooks::queue(&app, HookEvent::Edited, std::slice::from_ref(&id));
    }
    Ok(it)
}

/// ノートを書き換えて離れたとき。中身が変わったときのフックを呼ぶ。
#[tauri::command]
pub(crate) async fn note_left(app: tauri::AppHandle, id: String) {
    hooks::queue(&app, HookEvent::Changed, &[id]);
}

#[tauri::command]
pub(crate) async fn delete_item(cur: State<'_, Current>, id: String) -> Result<(), String> {
    with(&cur, |l| l.delete_item(&id))
}

#[tauri::command]
pub(crate) async fn save_state(cur: State<'_, Current>, state: LibraryState) -> Result<(), String> {
    with(&cur, |l| l.save_state(&state))
}

#[tauri::command]
pub(crate) async fn tag_history(cur: State<'_, Current>) -> Result<Vec<String>, String> {
    with(&cur, |l| l.tag_history())
}

#[tauri::command]
pub(crate) async fn save_tag_history(
    cur: State<'_, Current>,
    tags: Vec<String>,
) -> Result<(), String> {
    with(&cur, |l| l.save_tag_history(&tags))
}

#[tauri::command]
pub(crate) async fn open_history(cur: State<'_, Current>) -> Result<Vec<String>, String> {
    with(&cur, |l| l.open_history())
}

#[tauri::command]
pub(crate) async fn save_open_history(
    cur: State<'_, Current>,
    ids: Vec<String>,
) -> Result<(), String> {
    with(&cur, |l| l.save_open_history(&ids))
}

#[tauri::command]
pub(crate) async fn tabs(
    cur: State<'_, Current>,
) -> Result<Option<serde_json::Map<String, Value>>, String> {
    with(&cur, |l| l.tabs())
}

#[tauri::command]
pub(crate) async fn save_tabs(
    cur: State<'_, Current>,
    tabs: serde_json::Map<String, Value>,
) -> Result<(), String> {
    with(&cur, |l| l.save_tabs(&tabs))
}

#[tauri::command]
pub(crate) async fn create_note(
    cur: State<'_, Current>,
    name: String,
    place: Place,
) -> Result<StoredItem, String> {
    with(&cur, |l| l.create_note(&name, &place))
}

#[tauri::command]
pub(crate) async fn create_project(
    cur: State<'_, Current>,
    name: String,
) -> Result<StoredProject, String> {
    with(&cur, |l| l.create_project(&name))
}

#[tauri::command]
pub(crate) async fn save_project(
    cur: State<'_, Current>,
    name: String,
    cover: serde_json::Value,
) -> Result<(), String> {
    with(&cur, |l| l.save_project(&name, cover))
}

#[tauri::command]
pub(crate) async fn save_tag_cover(
    cur: State<'_, Current>,
    tag: String,
    cover: serde_json::Value,
) -> Result<(), String> {
    with(&cur, |l| l.save_tag_cover(&tag, cover))
}

#[tauri::command]
pub(crate) async fn rename_tag(
    cur: State<'_, Current>,
    from: String,
    to: String,
    keep_from: bool,
) -> Result<(), String> {
    with(&cur, |l| l.rename_tag(&from, &to, keep_from))
}

#[tauri::command]
pub(crate) async fn delete_tag_cover(cur: State<'_, Current>, tag: String) -> Result<(), String> {
    with(&cur, |l| l.delete_tag_cover(&tag))
}

/// ファイルを動かしたあとで、ライブラリを突き合わせ直して画面に知らせる。
pub(crate) fn recheck(app: &tauri::AppHandle) -> Result<(), String> {
    let cur = app.state::<Current>();
    let (id, root, plugins, cache, thumbs) = with_session(&cur, |s| {
        Ok((
            s.id,
            s.lib.root().to_owned(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
            s.thumbs.clone(),
        ))
    })?;
    let app = app.clone();
    CHECKING.fetch_add(1, Ordering::Relaxed);
    background::spawn(move || {
        check(&app, id, &root, &plugins, &cache, &thumbs);
        CHECKING.fetch_sub(1, Ordering::Relaxed);
    });
    Ok(())
}

#[tauri::command]
pub(crate) async fn rename_project(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    from: String,
    to: String,
) -> Result<(), String> {
    with(&cur, |l| l.rename_project(&from, &to))?;
    recheck(&app)
}

#[tauri::command]
pub(crate) async fn delete_project(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    name: String,
) -> Result<(), String> {
    let r = with(&cur, |l| l.delete_project(&name));
    recheck(&app)?;
    r
}

#[tauri::command]
pub(crate) async fn relink_meta(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    meta: PathBuf,
    to: String,
) -> Result<(), String> {
    with(&cur, |l| l.relink_meta(&meta, &to))?;
    recheck(&app)
}

#[tauri::command]
pub(crate) async fn discard_meta(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    meta: PathBuf,
) -> Result<(), String> {
    with(&cur, |l| l.discard_meta(&meta))?;
    recheck(&app)
}
