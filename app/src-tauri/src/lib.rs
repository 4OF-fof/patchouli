pub mod cache;
pub mod import;
pub mod library;
pub mod note;
pub mod plugin;
mod settings;
pub mod thumb;
mod tidy;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use cache::Cache;
use library::{ItemPatch, Library, LibraryState, Opened, StoredItem, StoredProject};
use plugin::record::{self, Source};
use plugin::{By, Part, Reads, Registry, Runner, ViewOut};
use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 開いているライブラリと、そのサムネイルの置き場所、使うプラグイン。開く前は None。
#[derive(Default)]
struct Current(Mutex<Option<Session>>);

struct Session {
    lib: Library,
    thumbs: PathBuf,
    plugins: Arc<Registry>,
    /// 詳細の表示に使う。
    runner: Runner,
    /// 組み込み UI がサムネイルを作るあいだに、WASM が読んだ設定（素材の id → 設定）。put_thumbnail で使う。
    ui_reads: HashMap<String, Reads>,
}

/// 開発中に使う、動作確認のための場所。環境変数 var があればそこ、なければ example/ の下の dir。
/// リリースビルドには入れない。
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

/// 外のプラグインの本体を置くところ。開発中は、例のプラグインを入れた置き場（scripts/dev-library.ts が作る）。
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

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map_err(|e| e.to_string())
}

/// ライブラリ root に記録してあるプラグインの id。読めなければ None。
fn plugin_ids(root: &Path) -> Option<Vec<String>> {
    if !root.is_dir() {
        return None;
    }
    let r = record::Record::read(&record::path(root)).ok()?;
    Some(r.plugins.into_keys().collect())
}

/// 開くライブラリの場所。設定で選んだ場所か、まだ選んでいなければ、開発中は動作確認用のライブラリを開く。
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

/// 前に作ったときに読んだ設定（ext の素材）を、いまの値で埋めたもの。
fn reads_now(plugins: &Registry, before: Option<&Reads>, ext: &str) -> Reads {
    before.map_or_else(Reads::new, |r| {
        r.keys()
            .map(|k| (k.clone(), plugins.thumb_setting(ext, k)))
            .collect()
    })
}

/// サムネイルを作れるもののうち、できているものは thumb に入れ、まだのもので WASM が作るものは作る仕事にする。
/// 組み込み UI が作るものは、画面が作って put_thumbnail で渡す。
/// できているものの大きさは、サムネイルの大きさで代える（縦横比が同じなので）。
/// 返すのは、作る仕事、いまのサムネイルすべての場所、すべての場所を決められたか。
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
        let Some(by) = plugins.handles(&it.ext, Part::Thumbnail) else {
            continue;
        };
        // 写しにあった場所は、消されていることもあるので確かめ直す
        it.thumb = None;
        // 値が変わっていれば、場所が変わって作り直しになる
        let now = reads_now(plugins, reads.get(&it.file), &it.ext);
        let Some(out) = thumb::path_for(thumbs, &it.file, &now) else {
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
        } else if by == By::Wasm {
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
fn make_thumbs(
    app: &tauri::AppHandle,
    plugins: &Arc<Registry>,
    cache: &Cache,
    jobs: Vec<thumb::Job>,
) {
    thumb::make_all(plugins, jobs, |j, p| {
        tell_thumb(app, cache, &j.id, &j.src, &p.out, p.size, &p.reads)
    })
}

/// src のサムネイル file ができたことを、写しに書いて画面へ知らせる。
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

/// ライブラリを開く。前に開いたときの写しがあればそれを返し、裏でファイルと突き合わせて、違いを library-changed で知らせる。
/// 写しがなければ、ファイルを読み終えてから返す。
#[tauri::command]
async fn open_library(app: tauri::AppHandle, cur: State<'_, Current>) -> Result<Opened, String> {
    let root = library::canonical(&library_root(&app)?)?;
    let (plugins, plugin_problems) = Registry::open(&root, &plugin_dir(&app)?);
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
    let runner = Runner::new(Arc::clone(&plugins));
    *cur.0.lock().map_err(|e| e.to_string())? = Some(Session {
        lib,
        thumbs: thumbs.clone(),
        plugins: Arc::clone(&plugins),
        runner,
        ui_reads: HashMap::new(),
    });
    if checking {
        std::thread::spawn(move || check(&app, &root, &plugins, &cache, &thumbs));
    }
    Ok(opened)
}

/// 裏でサムネイルの要らなくなったものを消し、足りないものを作る。
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

/// 写しから開いたライブラリを、ファイルと突き合わせる。開き直していたら（plugins が替わっていたら）何もしない。
fn check(
    app: &tauri::AppHandle,
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
            Some(s) if Arc::ptr_eq(&s.plugins, plugins) => s.lib.apply(fresh, scan),
            _ => return,
        }
    };
    // 何もないのに送ると、画面がライブラリを作り直してしまう
    if !changes.is_empty() {
        let _ = app.emit("library-changed", &changes);
    }
    spawn_thumbs(app, plugins, cache, thumbs, job, all_found);
}

/// 落とそうとしているものの中身を数える。
#[tauri::command]
async fn inspect_drop(
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
) -> Result<import::DropInfo, String> {
    let g = cur.0.lock().map_err(|e| e.to_string())?;
    Ok(match g.as_ref() {
        Some(s) => import::inspect(&paths, Some(s.lib.root()), &s.plugins),
        None => import::inspect(&paths, None, &Registry::builtin()),
    })
}

/// paths を取り込み、取り込んだ画像のサムネイルを裏で作る。projects は、プロジェクトにするフォルダの paths の中での位置。
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

/// サムネイルができたときに画面へ送る知らせ。
#[derive(Clone, Serialize)]
struct ThumbReady<'a> {
    id: &'a str,
    file: &'a Path,
    /// 素材の大きさ（わからなければサムネイルの大きさ）。縦横比を決めるのに使う。
    width: u32,
    height: u32,
}

/// プラグインの一覧と、それぞれの問題。
#[tauri::command]
async fn plugins(cur: State<'_, Current>) -> Result<plugin::PluginReport, String> {
    with_session(&cur, |s| Ok(s.plugins.report()))
}

fn root_of(cur: &State<Current>) -> Result<PathBuf, String> {
    with(cur, |l| Ok(l.root().to_owned()))
}

/// プラグインを取得先から入れて、開いているライブラリに記録する。expect は取得元の検証値。
/// 入れたあとは、画面がライブラリを開き直す。
fn install_from(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    source: Source,
    expect: Option<&str>,
) -> Result<(), String> {
    let root = root_of(cur)?;
    let (m, hash) =
        plugin::install::install(&source, &plugin_dir(app)?, &plugin::builtin_ids(), expect)?;
    record::update(&root, |r| {
        let e = r.plugins.entry(m.id).or_default();
        e.version = Some(m.version);
        e.source = Some(source);
        e.hash = Some(hash);
    })
}

#[tauri::command]
async fn install_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    source: Source,
) -> Result<(), String> {
    install_from(&app, &cur, source, None)
}

/// 記録してある取得先から入れ直す。この端末に入っていないものは、取得元が記録と同じときだけ入れる。
#[tauri::command]
async fn update_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
) -> Result<(), String> {
    let (recorded, installed) = with_session(&cur, |s| {
        Ok((s.plugins.source_of(&id), s.plugins.installed(&id)))
    })?;
    let (source, hash) = recorded.ok_or_else(|| format!("{id} の取得先が記録されていません"))?;
    let expect = hash.as_deref().filter(|_| !installed);
    install_from(&app, &cur, source, expect)
}

/// 開いているライブラリの記録と設定から外す。ほかのどのライブラリでも使っていなければ、アプリからも消す。
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

/// プラグインを入れるフォルダか zip を選ぶ窓を出す。選ばなければ None。
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

/// 素材の詳細に出すもの。受け持つプラグインが決める。
#[tauri::command]
async fn item_view(cur: State<'_, Current>, id: String) -> Result<Option<ViewOut>, String> {
    with_session(&cur, |s| {
        let (path, ext) = s.lib.asset(&id)?;
        let path = path.to_owned();
        Ok(s.runner.view(&ext, &path))
    })
}

/// 詳細に出す画像を、詳細を受け持つ WASM が PNG にしたもの。
#[tauri::command]
async fn item_decoded(cur: State<'_, Current>, id: String) -> Result<tauri::ipc::Response, String> {
    let png = with_session(&cur, |s| {
        let (path, ext) = s.lib.asset(&id)?;
        let path = path.to_owned();
        let keep = s.plugins.keeps_decoded(&ext).and_then(|(plugin, format)| {
            let dir = thumb::decoded_dir(&s.thumbs, plugin, format);
            thumb::path_for(&dir, &path, &Reads::new())
        });
        if let Some(png) = keep.as_ref().and_then(|p| std::fs::read(p).ok()) {
            return Ok(png);
        }
        let png = s.runner.decode(&ext, &path)?;
        if let Some(out) = keep {
            thumb::keep_decoded(&out, &png);
        }
        Ok(png)
    })?;
    Ok(tauri::ipc::Response::new(png))
}

/// 組み込み UI から、開いている素材の中身を読む。
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

/// 素材 id の part を受け持つ組み込み UI から、そのプラグインの WASM の関数を呼ぶ。
/// plugin があれば、依存先のそのプラグインのものを呼ぶ。
#[tauri::command]
async fn plugin_call(
    cur: State<'_, Current>,
    id: String,
    part: Part,
    plugin: Option<String>,
    method: String,
    args: String,
) -> Result<String, String> {
    with_session(&cur, |s| {
        let (path, ext) = s.lib.asset(&id)?;
        let path = path.to_owned();
        let (r, reads) = s
            .runner
            .reading(|r| r.call_ui(&ext, part, &path, plugin.as_deref(), &method, &args));
        if part == Part::Thumbnail {
            s.ui_reads.entry(id).or_default().extend(reads);
        }
        r
    })
}

/// 組み込み UI のプラグインが自分で残した値。
#[tauri::command]
async fn plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
) -> Result<Option<String>, String> {
    with_session(&cur, |s| s.plugins.data_of(&plugin, &key))
}

/// 組み込み UI のプラグインが値を残す。value がなければ消す。
#[tauri::command]
async fn set_plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    with_session(&cur, |s| s.plugins.set_data_of(&plugin, &key, value))
}

/// 使っているプラグインの、設定のいまの値。
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

/// 組み込み UI が作ったサムネイル（本文が PNG）を置いて、画面へ知らせる。
/// 見出しの id は素材、width と height は素材の大きさ（わからなければ付けない）、
/// settings は作るときに読んだ設定の key の JSON の配列（ASCII にしたもの）。
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
        let out = thumb::path_for(&s.thumbs, path, &reads)
            .ok_or_else(|| format!("{} の読み込みに失敗しました", path.display()))?;
        Ok((path.to_owned(), out, s.lib.cache(), reads))
    })?;
    let size = thumb::place(png, original, &out).map_err(|e| format!("{}: {e}", src.display()))?;
    tell_thumb(&app, &cache, &id, &src, &out, size, &reads);
    Ok(())
}

/// 使っているプラグインのフォルダの中のファイルを返す。
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

/// フォルダを選ぶ窓を出し、選んだフォルダを次から開くライブラリにする。選ばなければ false。
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

/// 開いたことのあるライブラリ。
#[derive(Serialize)]
struct KnownLibrary {
    path: PathBuf,
    name: String,
    /// 最後に開いた日時（UNIX ミリ秒）。
    opened: f64,
    exists: bool,
    current: bool,
}

/// 開いたことのあるライブラリ。最後に開いた順。
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

/// path を次から開くライブラリにする。開き直すのは画面。
#[tauri::command]
async fn switch_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{} が見つかりません", path.display()));
    }
    settings::set_library(&app, &path)
}

/// 開いたことのあるライブラリの一覧から外す。
#[tauri::command]
async fn forget_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    settings::forget(&app, &path)
}

/// 開いているライブラリの分のキャッシュの量。
#[tauri::command]
async fn cache_usage(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<tidy::Usage, String> {
    Ok(tidy::usage(&cache_dir(&app)?, &root_of(&cur)?))
}

/// kind のキャッシュを、開いているライブラリの分だけ消す。all は未使用のプラグインも消す。
/// 開いているライブラリを閉じるので、画面は開き直す。
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

/// どのライブラリでも使っていないプラグインと、その場所。
/// 開いたことのあるライブラリの記録を読み、読めないものは最後に開いたときの記録で代える。
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

/// どのライブラリでも使っていないプラグインを、アプリから消す。
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

/// 保存する。文章がファイルの外での変更と食い違って書かなかったときは、読み直した項目を返す。
#[tauri::command]
async fn save_item(
    cur: State<'_, Current>,
    id: String,
    patch: ItemPatch,
) -> Result<Option<StoredItem>, String> {
    with(&cur, |l| l.save_item(&id, &patch))
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
            save_state,
            create_note,
            create_project,
            save_project,
            plugins,
            install_plugin,
            update_plugin,
            remove_plugin,
            pick_plugin,
            set_plugin_setting,
            item_view,
            item_decoded,
            plugin_read,
            plugin_call,
            plugin_settings,
            plugin_data,
            set_plugin_data,
            put_thumbnail,
            libraries,
            switch_library,
            forget_library,
            cache_usage,
            clear_cache,
            unused_plugins,
            remove_unused_plugins
        ])
        .setup(|app| {
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
