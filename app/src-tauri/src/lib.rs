pub mod cache;
pub mod import;
pub mod library;
pub mod note;
pub mod plugin;
mod settings;
mod shell;
pub mod thumb;
mod tidy;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use cache::Cache;
use library::{ItemPatch, Library, LibraryState, Opened, StoredItem, StoredProject};
use plugin::record::{self, Source};
use plugin::{By, Part, Reads, Registry, Runner, ViewOut};
use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Current(Mutex<Option<Session>>);

struct Session {
    /// 素材を読み直すたびに変わる。裏の突き合わせが、読み直す前の結果を持ち込まないようにする。
    id: u64,
    lib: Library,
    thumbs: PathBuf,
    plugins: Arc<Registry>,
    /// 詳細の表示に使う。プラグインが長く動いてもほかの操作を止めないよう、Session のロックを放してから使う。
    runner: Arc<Mutex<Runner>>,
    ui_reads: HashMap<String, Reads>,
}

#[cfg(debug_assertions)]
fn dev_path(var: &str, dir: &str) -> PathBuf {
    std::env::var_os(var).map_or_else(
        || {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../example")
                .join(dir)
        },
        PathBuf::from,
    )
}

fn plugin_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Ok(dev_path("PATCHOULI_PLUGIN_DIR", "dev-plugins"))
    }
    #[cfg(not(debug_assertions))]
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins"))
}

fn next_session() -> u64 {
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

fn dev_unpack_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(cache_dir(app).ok()?.join("dev-plugins"))
}

fn dev_places(app: &tauri::AppHandle) -> Option<plugin::Dev> {
    let d = settings::developer(app)
        .inspect_err(|e| log::warn!("開発者モードの設定を読めない: {e}"))
        .ok()
        .filter(|d| d.enabled)?;
    Some(plugin::Dev {
        dirs: d.plugin_dirs,
        repos: d.repos,
        unpack: dev_unpack_dir(app)?,
    })
}

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map_err(|e| e.to_string())
}

fn plugin_ids(root: &Path) -> Option<Vec<String>> {
    if !root.is_dir() {
        return None;
    }
    let r = record::Record::read(&record::path(root)).ok()?;
    Some(r.plugins.into_keys().collect())
}

fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("PATCHOULI_LIBRARY") {
        return Ok(PathBuf::from(p));
    }
    if let Some(p) = settings::library(app)? {
        return Ok(p);
    }
    #[cfg(debug_assertions)]
    return Ok(dev_path("PATCHOULI_LIBRARY", "dev-library"));
    #[cfg(not(debug_assertions))]
    Err("ライブラリが選択されていません。設定から選択してください".into())
}

fn with<T>(
    cur: &State<Current>,
    f: impl FnOnce(&mut Library) -> Result<T, String>,
) -> Result<T, String> {
    with_session(cur, |s| f(&mut s.lib))
}

fn with_session<T>(
    cur: &State<Current>,
    f: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut g = cur.0.lock().map_err(|e| e.to_string())?;
    let s = g.as_mut().ok_or("ライブラリを開いていません")?;
    f(s)
}

struct Target {
    id: String,
    path: PathBuf,
    ext: String,
    runner: Arc<Mutex<Runner>>,
    plugins: Arc<Registry>,
    thumbs: PathBuf,
}

impl Target {
    fn of(cur: &State<Current>, id: &str) -> Result<Target, String> {
        with_session(cur, |s| {
            let (path, ext) = s.lib.asset(id)?;
            Ok(Target {
                id: id.to_owned(),
                path: path.to_owned(),
                ext,
                runner: Arc::clone(&s.runner),
                plugins: Arc::clone(&s.plugins),
                thumbs: s.thumbs.clone(),
            })
        })
    }

    /// プラグインを呼ぶ。ほかの呼び出しが使っているあいだは待たず、新しく作って使う。
    fn run<T>(&self, f: impl FnOnce(&mut Runner, &str, &Path) -> T) -> T {
        match self.runner.try_lock() {
            Ok(mut r) => f(&mut r, &self.ext, &self.path),
            Err(_) => f(
                &mut Runner::new(Arc::clone(&self.plugins)),
                &self.ext,
                &self.path,
            ),
        }
    }
}

fn reads_now(plugins: &Registry, before: Option<&Reads>, ext: &str) -> Reads {
    before.map_or_else(Reads::new, |r| {
        r.keys()
            .map(|k| (k.clone(), plugins.thumb_setting(ext, k)))
            .collect()
    })
}

fn plan_thumbs<'a>(
    plugins: &Registry,
    thumbs: &Path,
    cache: &Cache,
    items: impl IntoIterator<Item = &'a mut StoredItem>,
) -> (Vec<thumb::Job>, Vec<PathBuf>, bool) {
    let reads = cache.thumb_reads();
    let mut jobs = Vec::new();
    let mut current = Vec::new();
    let mut all = true;
    for it in items {
        // 写しにあった場所は、消されていることもあるので確かめ直す
        it.thumb = None;
        // 波形を作るものは、波形をサムネイルにすることがある
        let by = plugins.handles(&it.ext, Part::Thumbnail);
        if by.is_none() && plugins.handles(&it.ext, Part::Waveform).is_none() {
            continue;
        }
        // 値が変わっていれば、場所が変わって作り直しになる
        let now = reads_now(plugins, reads.get(&it.file), &it.ext);
        let Some(out) = thumb::path_for(thumbs, &it.id, &it.file, &now) else {
            all = false;
            continue;
        };
        current.push(out.clone());
        if out.exists() {
            if it.width.is_none()
                && let Ok(s) = imagesize::size(&out)
            {
                (it.width, it.height) = (Some(s.width as u32), Some(s.height as u32));
            }
            it.thumb = Some(out);
        } else if by == Some(By::Wasm) {
            thumb::start_making(&it.file);
            jobs.push(thumb::Job {
                id: it.id.clone(),
                src: it.file.clone(),
                ext: it.ext.clone(),
                dir: thumbs.to_owned(),
                mtime: it.mtime,
            });
        }
    }
    (jobs, current, all)
}

/// 裏でサムネイルを作り、できたものから画面へ知らせる。
/// プラグインが作らなかったもので、波形がもうあれば、波形をサムネイルにする。
fn make_thumbs(
    app: &tauri::AppHandle,
    plugins: &Arc<Registry>,
    cache: &Cache,
    jobs: Vec<thumb::Job>,
) {
    thumb::make_all(plugins, jobs, |j, p| {
        thumb::end_making(&j.src);
        let made = match p {
            Some(p) => {
                tell_thumb(app, cache, &j.id, &j.src, &p.out, p.size, &p.reads);
                Ok(())
            }
            None => wave_thumb(app, cache, plugins, &j.dir, &j.id, &j.src, &j.ext),
        };
        if let Err(e) = made {
            log::warn!("波形をサムネイルにできない: {e}");
        }
    })
}

fn wave_thumb(
    app: &tauri::AppHandle,
    cache: &Cache,
    plugins: &Registry,
    thumbs: &Path,
    id: &str,
    src: &Path,
    ext: &str,
) -> Result<(), String> {
    let err = || format!("{} の読み込みに失敗しました", src.display());
    let Some(wave) = thumb::wave_path(thumbs, id, src).and_then(|p| std::fs::read(p).ok()) else {
        return Ok(());
    };
    let reads = reads_now(plugins, cache.thumb_reads().get(src), ext);
    let out = thumb::path_for(thumbs, id, src, &reads).ok_or_else(err)?;
    if out.exists() {
        return Ok(());
    }
    let png = thumb::draw_wave(&wave, plugins.ratio_of(ext))?;
    let size = thumb::place(&png, None, &out).map_err(|e| format!("{}: {e}", src.display()))?;
    tell_thumb(app, cache, id, src, &out, size, &reads);
    Ok(())
}

fn tell_thumb(
    app: &tauri::AppHandle,
    cache: &Cache,
    id: &str,
    src: &Path,
    file: &Path,
    (width, height): (u32, u32),
    reads: &Reads,
) {
    cache.set_thumb(src, file, (width, height), reads);
    let _ = app.emit(
        "thumbnail",
        ThumbReady {
            id,
            file,
            width,
            height,
        },
    );
}

#[tauri::command]
async fn open_library(app: tauri::AppHandle, cur: State<'_, Current>) -> Result<Opened, String> {
    let root = library::canonical(&library_root(&app)?)?;
    let (plugins, plugin_problems) =
        Registry::open(&root, &plugin_dir(&app)?, dev_places(&app).as_ref());
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
        std::thread::spawn(move || cache::sweep(&dir, &root));
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
                let (lib, mut scan) =
                    Library::scan(&root, Arc::clone(&plugins), Arc::clone(&cache));
                let thumbs_job = plan_thumbs(
                    &plugins,
                    &thumbs,
                    &cache,
                    scan.items.iter_mut().map(|r| &mut r.item),
                );
                let all_found = thumbs_job.2 && scan.problems.is_empty();
                let opened = lib.opened(scan);
                spawn_thumbs(&app, &plugins, &cache, &thumbs, thumbs_job, all_found);
                (lib, opened, false)
            }
        };
    opened.problems.extend(plugin_problems);
    let runner = Arc::new(Mutex::new(Runner::new(Arc::clone(&plugins))));
    let id = next_session();
    let mut lib = lib;
    for it in lib.sync_link_names() {
        if let Some(x) = opened.items.iter_mut().find(|x| x.id == it.id) {
            *x = it;
        }
    }
    *cur.0.lock().map_err(|e| e.to_string())? = Some(Session {
        id,
        lib,
        thumbs: thumbs.clone(),
        plugins: Arc::clone(&plugins),
        runner,
        ui_reads: HashMap::new(),
    });
    if checking {
        CHECKING.fetch_add(1, Ordering::Relaxed);
        std::thread::spawn(move || {
            check(&app, id, &root, &plugins, &cache, &thumbs);
            CHECKING.fetch_sub(1, Ordering::Relaxed);
        });
    }
    Ok(opened)
}

#[tauri::command]
async fn reload_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    wait: bool,
) -> Result<library::Opened, String> {
    let (root, old) = with_session(&cur, |s| {
        Ok((s.lib.root().to_owned(), Arc::clone(&s.plugins)))
    })?;
    if !wait {
        old.stop();
    }
    while thumb::pending() > 0 {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    old.stop();
    let (plugins, problems) = Registry::open(&root, &plugin_dir(&app)?, dev_places(&app).as_ref());
    let plugins = Arc::new(plugins);
    let (mut opened, thumbs, cache) = with_session(&cur, |s| {
        s.lib.set_plugins(Arc::clone(&plugins));
        let opened = s.lib.snapshot();
        s.plugins = Arc::clone(&plugins);
        s.runner = Arc::new(Mutex::new(Runner::new(Arc::clone(&plugins))));
        s.ui_reads.clear();
        Ok((opened, s.thumbs.clone(), s.lib.cache()))
    })?;
    let job = plan_thumbs(&plugins, &thumbs, &cache, &mut opened.items);
    let all_found = job.2;
    spawn_thumbs(&app, &plugins, &cache, &thumbs, job, all_found);
    opened.problems.extend(problems);
    Ok(opened)
}

#[tauri::command]
fn plugin_work() -> Vec<String> {
    thumb::pending_items()
}

#[tauri::command]
fn stop_plugin_work() {
    thumb::stop();
}

static CHECKING: AtomicUsize = AtomicUsize::new(0);

#[tauri::command]
fn checking() -> bool {
    CHECKING.load(Ordering::Relaxed) > 0
}

fn spawn_thumbs(
    app: &tauri::AppHandle,
    plugins: &Arc<Registry>,
    cache: &Arc<Cache>,
    thumbs: &Path,
    (jobs, current, _): (Vec<thumb::Job>, Vec<PathBuf>, bool),
    all_found: bool,
) {
    let (app, plugins, cache, dir) = (
        app.clone(),
        Arc::clone(plugins),
        Arc::clone(cache),
        thumbs.to_owned(),
    );
    std::thread::spawn(move || {
        thumb::prune(&dir, &current, all_found);
        make_thumbs(&app, &plugins, &cache, jobs);
    });
}

fn check(
    app: &tauri::AppHandle,
    id: u64,
    root: &Path,
    plugins: &Arc<Registry>,
    cache: &Arc<Cache>,
    thumbs: &Path,
) {
    let (fresh, mut scan) = Library::scan(root, Arc::clone(plugins), Arc::clone(cache));
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
        let Ok(mut g) = cur.0.lock() else {
            return;
        };
        match g.as_mut() {
            Some(s) if s.id == id => {
                let mut changes = s.lib.apply(fresh, scan);
                for it in s.lib.sync_link_names() {
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
    spawn_thumbs(app, plugins, cache, thumbs, job, all_found);
}

#[tauri::command]
async fn inspect_drop(
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
) -> Result<import::DropInfo, String> {
    let g = cur.0.lock().map_err(|e| e.to_string())?;
    Ok(match g.as_ref() {
        Some(s) => import::inspect(&paths, Some(s.lib.root())),
        None => import::inspect(&paths, None),
    })
}

#[tauri::command]
async fn import_files(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
    folder: Option<String>,
    projects: Vec<usize>,
) -> Result<import::Imported, String> {
    let (mut out, thumbs, plugins, cache) = with_session(&cur, |s| {
        Ok((
            s.lib.import(&paths, folder.as_deref(), &projects)?,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
        ))
    })?;
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut out.items);
    if !jobs.is_empty() {
        std::thread::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    Ok(out)
}

#[tauri::command]
async fn import_data(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<StoredItem, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("リクエスト本文がファイルの中身ではありません".into());
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let meta: (String, Option<String>) = head("meta")
        .map(serde_json::from_str)
        .ok_or("ファイル名が指定されていません")?
        .map_err(|e| format!("meta の読み込みに失敗しました：{e}"))?;
    let (name, folder) = meta;
    let (item, thumbs, plugins, cache) = with_session(&cur, |s| {
        Ok((
            s.lib.import_data(&name, bytes, folder.as_deref())?,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
        ))
    })?;
    let mut items = vec![item];
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut items);
    if !jobs.is_empty() {
        std::thread::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    items.pop().ok_or_else(|| "取り込みに失敗しました".into())
}

#[derive(Clone, Serialize)]
struct ThumbReady<'a> {
    id: &'a str,
    file: &'a Path,
    width: u32,
    height: u32,
}

#[tauri::command]
async fn plugins(cur: State<'_, Current>) -> Result<plugin::PluginReport, String> {
    with_session(&cur, |s| Ok(s.plugins.report()))
}

fn root_of(cur: &State<Current>) -> Result<PathBuf, String> {
    with(cur, |l| Ok(l.root().to_owned()))
}

fn install_from(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    source: Source,
    expect: Option<&str>,
    enable: bool,
) -> Result<(), String> {
    let root = root_of(cur)?;
    let (m, hash) =
        plugin::install::install(&source, &plugin_dir(app)?, &plugin::builtin_ids(), expect)?;
    record::update(&root, |r| {
        let e = r.plugins.entry(m.id).or_default();
        e.version = Some(m.version);
        e.source = Some(source);
        e.hash = Some(hash);
        if enable {
            e.disabled = false;
        }
    })
}

#[tauri::command]
async fn install_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    source: Source,
) -> Result<(), String> {
    install_from(&app, &cur, source, None, true)
}

#[tauri::command]
async fn update_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
) -> Result<(), String> {
    let recorded = with_session(&cur, |s| Ok(s.plugins.source_of(&id)))?;
    let (source, hash) = recorded.ok_or_else(|| format!("{id} の取得先が記録されていません"))?;
    // 無効にしてあるものは読んでいないので、入っているかはフォルダで確かめる
    let installed = plugin_dir(&app)?.join(&id).join(plugin::MANIFEST).is_file();
    let expect = hash.as_deref().filter(|_| !installed);
    install_from(&app, &cur, source, expect, false)
}

#[tauri::command]
async fn set_plugin_enabled(
    cur: State<'_, Current>,
    id: String,
    dev: bool,
    enabled: bool,
) -> Result<(), String> {
    let root = root_of(&cur)?;
    if !dev
        && !record::Record::read(&record::path(&root))?
            .plugins
            .contains_key(&id)
    {
        return Err(format!(
            "プラグイン「{id}」はライブラリに記録されていません"
        ));
    }
    record::update(&root, |r| {
        if !dev {
            if let Some(e) = r.plugins.get_mut(&id) {
                e.disabled = !enabled;
            }
        } else if enabled {
            r.dev.insert(id);
        } else {
            r.dev.remove(&id);
        }
    })
}

#[tauri::command]
async fn developer(app: tauri::AppHandle) -> Result<settings::Developer, String> {
    settings::developer(&app)
}

#[tauri::command]
async fn set_developer(
    app: tauri::AppHandle,
    developer: settings::Developer,
) -> Result<(), String> {
    settings::set_developer(&app, &developer)
}

#[tauri::command]
async fn pick_dev_path(app: tauri::AppHandle, repo: bool) -> Result<Option<PathBuf>, String> {
    let title = if repo {
        "プラグインのリポジトリを選択"
    } else {
        "開発用プラグインのフォルダを選択"
    };
    let Some(p) = app.dialog().file().set_title(title).blocking_pick_folder() else {
        return Ok(None);
    };
    let p = p.into_path().map_err(|e| e.to_string())?;
    if repo && !p.join(plugin::MANIFEST).is_file() {
        return Err(format!(
            "{}: {} が見つかりません",
            p.display(),
            plugin::MANIFEST
        ));
    }
    Ok(Some(p))
}

#[tauri::command]
async fn remove_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
) -> Result<(), String> {
    let root = root_of(&cur)?;
    record::update(&root, |r| {
        r.plugins.remove(&id);
    })?;
    record::forget(&root, &id)?;
    let unused = unused_plugins_of(&app, &cur)?;
    remove_plugins(unused.into_iter().filter(|(u, _)| u.id == id).collect())
}

#[tauri::command]
async fn pick_plugin(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    app.dialog()
        .file()
        .set_title("プラグインの ZIP ファイルを選択")
        .add_filter("zip", &["zip"])
        .blocking_pick_file()
        .map(|p| p.into_path().map_err(|e| e.to_string()))
        .transpose()
}

/// 設定を変え、その設定を読んで作ったサムネイルを作り直す。
/// WASM が作るものは裏で作り、組み込み UI が作るものは返す（画面が作る）。
#[tauri::command]
async fn set_plugin_setting(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    key: String,
    value: Value,
) -> Result<Vec<StoredItem>, String> {
    let (plugins, thumbs, cache) = with_session(&cur, |s| {
        s.plugins.set_setting(&id, &key, &value)?;
        Ok((Arc::clone(&s.plugins), s.thumbs.clone(), s.lib.cache()))
    })?;
    if let Some(format) = key.strip_prefix(&plugin::keep_decoded_key(""))
        && value == Value::Bool(false)
    {
        let dir = thumb::decoded_dir(&thumbs, &id, format);
        if let Err(e) = std::fs::remove_dir_all(&dir)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            log::warn!("詳細用の画像を消せない: {}: {e}", dir.display());
        }
    }
    let reads = cache.thumb_reads();
    if !reads.values().any(|r| r.contains_key(&key)) {
        return Ok(Vec::new());
    }
    let mut items: Vec<StoredItem> = cache
        .rows()
        .into_values()
        .map(|r| r.item)
        .filter(|it| {
            plugins.thumb_owner(&it.ext) == Some(id.as_str())
                && reads.get(&it.file).is_some_and(|r| r.contains_key(&key))
        })
        .collect();
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut items);
    // 前の値に戻したときなど、いまの値で作ったものが残っていれば、作り直さずにそれへ切り替える
    for it in &items {
        if let (Some(file), Some(size)) = (&it.thumb, it.width.zip(it.height)) {
            let now = reads_now(&plugins, reads.get(&it.file), &it.ext);
            tell_thumb(&app, &cache, &it.id, &it.file, file, size, &now);
        }
    }
    items.retain(|it| {
        it.thumb.is_none() && plugins.handles(&it.ext, Part::Thumbnail) == Some(By::Ui)
    });
    if !jobs.is_empty() {
        std::thread::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    Ok(items)
}

#[tauri::command]
async fn item_view(cur: State<'_, Current>, id: String) -> Result<Option<ViewOut>, String> {
    Ok(Target::of(&cur, &id)?.run(|r, ext, path| r.view(ext, path)))
}

#[derive(Serialize)]
struct Detail {
    label: String,
    value: String,
}

#[derive(Serialize)]
struct Details {
    size: u64,
    rows: Vec<Detail>,
}

#[tauri::command]
async fn item_details(cur: State<'_, Current>, id: String) -> Result<Details, String> {
    let t = Target::of(&cur, &id)?;
    let size = std::fs::metadata(&t.path)
        .map_err(|e| format!("{}: {e}", t.path.display()))?
        .len();
    let rows = t
        .run(|r, ext, path| r.details(ext, path))
        .unwrap_or_else(|e| {
            log::warn!("ファイルの詳細を足せない: {}: {e}", t.path.display());
            Vec::new()
        });
    Ok(Details {
        size,
        rows: rows
            .into_iter()
            .map(|(label, value)| Detail { label, value })
            .collect(),
    })
}

#[tauri::command]
async fn item_decoded(cur: State<'_, Current>, id: String) -> Result<tauri::ipc::Response, String> {
    let t = Target::of(&cur, &id)?;
    let keep = t
        .plugins
        .keeps_decoded(&t.ext)
        .and_then(|(plugin, format)| {
            let dir = thumb::decoded_dir(&t.thumbs, plugin, format);
            thumb::path_for(&dir, &t.id, &t.path, &Reads::new())
        });
    if let Some(png) = keep.as_ref().and_then(|p| std::fs::read(p).ok()) {
        return Ok(tauri::ipc::Response::new(png));
    }
    let png = t.run(|r, ext, path| r.decode(ext, path))?;
    if let Some(out) = keep {
        thumb::keep(&out, &png);
    }
    Ok(tauri::ipc::Response::new(png))
}

#[tauri::command]
async fn reveal_item(cur: State<'_, Current>, id: String) -> Result<(), String> {
    let path = with(&cur, |l| Ok(l.asset(&id)?.0.to_owned()))?;
    shell::reveal(&path)
}

#[tauri::command]
async fn open_item_default(cur: State<'_, Current>, id: String) -> Result<(), String> {
    let path = with(&cur, |l| Ok(l.asset(&id)?.0.to_owned()))?;
    shell::open(&path)
}

#[tauri::command]
async fn plugin_read(
    cur: State<'_, Current>,
    id: String,
    offset: u64,
    length: u32,
) -> Result<tauri::ipc::Response, String> {
    let path = with(&cur, |l| Ok(l.asset(&id)?.0.to_owned()))?;
    Ok(tauri::ipc::Response::new(plugin::read(
        &path, offset, length,
    )?))
}

#[tauri::command]
async fn plugin_call(
    cur: State<'_, Current>,
    id: String,
    part: Part,
    plugin: Option<String>,
    method: String,
    args: String,
) -> Result<String, String> {
    let t = Target::of(&cur, &id)?;
    let (r, reads) = t.run(|r, ext, path| {
        r.reading(|r| r.call_ui(ext, part, path, plugin.as_deref(), &method, &args))
    });
    // 呼んでいるあいだにライブラリを開き直していたら、読んだ設定は残さない
    if part == Part::Thumbnail
        && let Ok(mut g) = cur.0.lock()
        && let Some(s) = g.as_mut()
        && Arc::ptr_eq(&s.plugins, &t.plugins)
    {
        s.ui_reads.entry(id).or_default().extend(reads);
    }
    r
}

#[tauri::command]
async fn plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
) -> Result<Option<String>, String> {
    with_session(&cur, |s| s.plugins.data_of(&plugin, &key))
}

#[tauri::command]
async fn set_plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    with_session(&cur, |s| s.plugins.set_data_of(&plugin, &key, value))
}

#[tauri::command]
async fn plugin_settings(
    cur: State<'_, Current>,
    plugin: String,
) -> Result<serde_json::Map<String, Value>, String> {
    with_session(&cur, |s| {
        s.plugins
            .settings_of(&plugin)
            .ok_or_else(|| format!("{plugin} は有効になっていません"))
    })
}

#[tauri::command]
async fn put_thumbnail(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("リクエスト本文が PNG ではありません".into());
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let id = head("id").ok_or("ID が指定されていません")?.to_owned();
    let num = |k: &str| head(k).and_then(|v| v.parse::<u32>().ok());
    let original = num("width").zip(num("height"));
    let keys: Vec<String> = head("settings")
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| format!("settings の読み込みに失敗しました：{e}"))?
        .unwrap_or_default();
    let (src, out, cache, reads) = with_session(&cur, |s| {
        let mut reads = s.ui_reads.remove(&id).unwrap_or_default();
        let (path, ext) = s.lib.asset(&id)?;
        if s.plugins.handles(&ext, Part::Thumbnail) != Some(By::Ui) {
            return Err(format!(
                "「.{ext}」のサムネイルは UI ファイルで生成する設定になっていません"
            ));
        }
        // 値は、WASM が読んだものと同じ形にそろえるため、こちらで引く
        for k in keys {
            let v = s.plugins.thumb_setting(&ext, &k);
            reads.insert(k, v);
        }
        let out = thumb::path_for(&s.thumbs, &id, path, &reads)
            .ok_or_else(|| format!("{} の読み込みに失敗しました", path.display()))?;
        Ok((path.to_owned(), out, s.lib.cache(), reads))
    })?;
    let size = thumb::place(png, original, &out).map_err(|e| format!("{}: {e}", src.display()))?;
    tell_thumb(&app, &cache, &id, &src, &out, size, &reads);
    Ok(())
}

#[tauri::command]
async fn missing_waveforms(
    cur: State<'_, Current>,
    ids: Vec<String>,
) -> Result<Vec<String>, String> {
    with_session(&cur, |s| {
        Ok(ids
            .into_iter()
            .filter(|id| {
                s.lib.asset(id).is_ok_and(|(path, ext)| {
                    s.plugins.ui_of(&ext, Part::Waveform).is_some()
                        && thumb::wave_path(&s.thumbs, id, path).is_some_and(|p| !p.exists())
                })
            })
            .collect())
    })
}

#[tauri::command]
async fn waveform(cur: State<'_, Current>, id: String) -> Result<tauri::ipc::Response, String> {
    let path = with_session(&cur, |s| {
        let (path, _) = s.lib.asset(&id)?;
        Ok(thumb::wave_path(&s.thumbs, &id, path))
    })?;
    let bytes = path.and_then(|p| std::fs::read(p).ok()).unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn put_waveform(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(wave) = request.body() else {
        return Err("リクエスト本文が波形のデータではありません".into());
    };
    if wave.is_empty() || wave.len() > 1 << 16 {
        return Err(format!("波形のデータの長さ（{}）が不正です", wave.len()));
    }
    let id = request
        .headers()
        .get("id")
        .and_then(|v| v.to_str().ok())
        .ok_or("ID が指定されていません")?
        .to_owned();
    let (src, ext, thumbs, plugins, cache) = with_session(&cur, |s| {
        let (path, ext) = s.lib.asset(&id)?;
        if s.plugins.ui_of(&ext, Part::Waveform).is_none() {
            return Err(format!("「.{ext}」の波形を作成するプラグインがありません"));
        }
        Ok((
            path.to_owned(),
            ext,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
        ))
    })?;
    let err = || format!("{} の読み込みに失敗しました", src.display());
    thumb::keep(&thumb::wave_path(&thumbs, &id, &src).ok_or_else(err)?, wave);
    if thumb::is_making(&src) {
        return Ok(());
    }
    wave_thumb(&app, &cache, &plugins, &thumbs, &id, &src, &ext)
}

fn plugin_file(
    app: &tauri::AppHandle,
    req: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let Some((id, rest)) = plugin::files::split(req.uri().path()) else {
        return plugin::files::serve("", None);
    };
    let cur = app.state::<Current>();
    let body = cur
        .0
        .lock()
        .ok()
        .and_then(|g| g.as_ref()?.plugins.file(&id, &rest));
    plugin::files::serve(&rest, body)
}

#[tauri::command]
async fn choose_library(app: tauri::AppHandle) -> Result<bool, String> {
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
struct KnownLibrary {
    path: PathBuf,
    name: String,
    opened: f64,
    exists: bool,
    current: bool,
}

#[tauri::command]
async fn libraries(
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
async fn switch_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{} が見つかりません", path.display()));
    }
    settings::set_library(&app, &path)
}

#[tauri::command]
async fn forget_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    settings::forget(&app, &path)
}

#[tauri::command]
async fn cache_usage(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<tidy::Usage, String> {
    Ok(tidy::usage(&cache_dir(&app)?, &root_of(&cur)?))
}

#[tauri::command]
async fn clear_cache(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    kind: tidy::Kind,
) -> Result<(), String> {
    let root = root_of(&cur)?;
    let unused = match kind {
        tidy::Kind::All => unused_plugins_of(&app, &cur)?,
        _ => Vec::new(),
    };
    drop(cur.0.lock().map_err(|e| e.to_string())?.take());
    tidy::clear(&cache_dir(&app)?, &root, kind)?;
    remove_plugins(unused)
}

fn unused_plugins_of(
    app: &tauri::AppHandle,
    cur: &State<Current>,
) -> Result<Vec<(tidy::Unused, PathBuf)>, String> {
    let mut used: HashSet<String> = HashSet::new();
    if let Some(ids) = root_of(cur).ok().and_then(|r| plugin_ids(&r)) {
        used.extend(ids);
    }
    for r in settings::recent(app)? {
        used.extend(plugin_ids(&r.path).unwrap_or(r.plugins));
    }
    Ok(tidy::unused(&plugin_dir(app)?, &used))
}

#[tauri::command]
async fn unused_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<Vec<tidy::Unused>, String> {
    Ok(unused_plugins_of(&app, &cur)?
        .into_iter()
        .map(|(u, _)| u)
        .collect())
}

#[tauri::command]
async fn remove_unused_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<(), String> {
    remove_plugins(unused_plugins_of(&app, &cur)?)
}

fn remove_plugins(plugins: Vec<(tidy::Unused, PathBuf)>) -> Result<(), String> {
    for (u, path) in plugins {
        std::fs::remove_dir_all(&path).map_err(|e| format!("{}: {e}", u.name))?;
    }
    Ok(())
}

#[tauri::command]
async fn save_item(
    cur: State<'_, Current>,
    id: String,
    patch: ItemPatch,
) -> Result<Option<StoredItem>, String> {
    with(&cur, |l| l.save_item(&id, &patch))
}

#[tauri::command]
async fn move_item(
    cur: State<'_, Current>,
    id: String,
    folder: Option<String>,
) -> Result<StoredItem, String> {
    with(&cur, |l| l.move_item(&id, folder.as_deref()))
}

#[tauri::command]
async fn rename_item(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    name: String,
) -> Result<StoredItem, String> {
    let (it, renamed) = with(&cur, |l| Ok((l.rename_item(&id, &name)?, l.sync_link_names())))?;
    if !renamed.is_empty() {
        let changes = library::Changes {
            items: renamed,
            ..library::Changes::default()
        };
        let _ = app.emit("library-changed", &changes);
    }
    Ok(it)
}

#[tauri::command]
async fn save_state(cur: State<'_, Current>, state: LibraryState) -> Result<(), String> {
    with(&cur, |l| l.save_state(&state))
}

#[tauri::command]
async fn create_note(
    cur: State<'_, Current>,
    name: String,
    folder: Option<String>,
) -> Result<StoredItem, String> {
    with(&cur, |l| l.create_note(&name, folder.as_deref()))
}

#[tauri::command]
async fn create_project(cur: State<'_, Current>, name: String) -> Result<StoredProject, String> {
    with(&cur, |l| l.create_project(&name))
}

#[tauri::command]
async fn save_project(
    cur: State<'_, Current>,
    name: String,
    cover: serde_json::Value,
) -> Result<(), String> {
    with(&cur, |l| l.save_project(&name, cover))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Current::default())
        .register_uri_scheme_protocol("plugin", |ctx, req| plugin_file(ctx.app_handle(), &req))
        .invoke_handler(tauri::generate_handler![
            open_library,
            choose_library,
            inspect_drop,
            import_files,
            save_item,
            move_item,
            save_state,
            create_note,
            create_project,
            save_project,
            plugins,
            install_plugin,
            update_plugin,
            remove_plugin,
            pick_plugin,
            set_plugin_enabled,
            developer,
            set_developer,
            pick_dev_path,
            reload_plugins,
            plugin_work,
            stop_plugin_work,
            checking,
            set_plugin_setting,
            item_view,
            item_details,
            rename_item,
            item_decoded,
            reveal_item,
            open_item_default,
            plugin_read,
            plugin_call,
            plugin_settings,
            plugin_data,
            set_plugin_data,
            put_thumbnail,
            import_data,
            missing_waveforms,
            put_waveform,
            waveform,
            libraries,
            switch_library,
            forget_library,
            cache_usage,
            clear_cache,
            unused_plugins,
            remove_unused_plugins
        ])
        .setup(|app| {
            // 前に起動したときに広げた開発版は、もう使っていない
            if let Some(d) = dev_unpack_dir(app.handle()) {
                let _ = std::fs::remove_dir_all(d);
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
