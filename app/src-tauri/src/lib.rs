pub mod import;
pub mod library;
pub mod note;
pub mod plugin;
mod settings;
pub mod thumb;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use library::{ItemPatch, Library, LibraryState, Opened, StoredItem, StoredProject};
use plugin::record::{self, Source};
use plugin::{By, Part, Registry, Runner, ViewOut};
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
}

/// 開発中に、動作確認のための場所を環境変数で替える。
fn dev_path(var: &str) -> Option<PathBuf> {
    cfg!(debug_assertions)
        .then(|| std::env::var_os(var))
        .flatten()
        .map(PathBuf::from)
}

/// 外のプラグインの本体を置くところ。開発中は、例のプラグインを入れた置き場（scripts/dev-library.ts が作る）。
fn plugin_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = dev_path("PATCHOULI_PLUGIN_DIR") {
        return Ok(p);
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../example/dev-plugins"));
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins"))
}

/// 開くライブラリの場所。設定で選んだ場所か、まだ選んでいなければ、開発中は動作確認用のライブラリを開く。
fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = dev_path("PATCHOULI_LIBRARY") {
        return Ok(p);
    }
    if let Some(p) = settings::library(app)? {
        return Ok(p);
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../example/dev-library"));
    }
    Err("ライブラリが選ばれていない。設定から選んでください".into())
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
    let s = g.as_mut().ok_or("ライブラリを開いていない")?;
    f(s)
}

/// サムネイルを作れるもののうち、できているものは thumb に入れ、まだのもので WASM が作るものは作る仕事にする。
/// 組み込み UI が作るものは、画面が作って put_thumbnail で渡す。
/// できているものの大きさは、サムネイルの大きさで代える（縦横比が同じなので）。
/// 返すのは、作る仕事、いまのサムネイルすべての場所、すべての場所を決められたか。
fn plan_thumbs(
    plugins: &Registry,
    thumbs: &Path,
    items: &mut [StoredItem],
) -> (Vec<thumb::Job>, Vec<PathBuf>, bool) {
    let mut jobs = Vec::new();
    let mut current = Vec::new();
    let mut all = true;
    for it in items.iter_mut() {
        let Some(by) = plugins.handles(&it.ext, Part::Thumbnail) else {
            continue;
        };
        let Some(out) = thumb::path_for(thumbs, &it.file) else {
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
                out,
                mtime: it.mtime,
            });
        }
    }
    (jobs, current, all)
}

/// 裏でサムネイルを作り、できたものから画面へ知らせる。
fn make_thumbs(app: &tauri::AppHandle, plugins: &Arc<Registry>, jobs: Vec<thumb::Job>) {
    thumb::make_all(plugins, jobs, |j, size| {
        tell_thumb(app, &j.id, &j.out, size)
    })
}

fn tell_thumb(app: &tauri::AppHandle, id: &str, file: &Path, (width, height): (u32, u32)) {
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
    let root = library_root(&app)?;
    let (plugins, plugin_problems) = Registry::open(&root, &plugin_dir(&app)?);
    let plugins = Arc::new(plugins);
    let (lib, mut opened) = Library::open(&root, Arc::clone(&plugins))?;
    opened.problems.extend(plugin_problems);
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let thumbs = thumb::dir_for(&cache, lib.root());
    std::fs::create_dir_all(&thumbs).map_err(|e| format!("{}: {e}", thumbs.display()))?;
    let scope = app.asset_protocol_scope();
    for dir in [lib.root(), &thumbs] {
        scope
            .allow_directory(dir, true)
            .map_err(|e| e.to_string())?;
    }
    // サムネイルは取り込んだときに作る。アプリの外で足された画像は、開いたときに見つけた時点で取り込んだものとみなす
    let (jobs, current, all) = plan_thumbs(&plugins, &thumbs, &mut opened.items);
    let all_found = all && opened.problems.is_empty();
    let dir = thumbs.clone();
    let made = Arc::clone(&plugins);
    std::thread::spawn(move || {
        thumb::prune(&dir, &current, all_found);
        make_thumbs(&app, &made, jobs);
    });
    let runner = Runner::new(Arc::clone(&plugins));
    *cur.0.lock().map_err(|e| e.to_string())? = Some(Session {
        lib,
        thumbs,
        plugins,
        runner,
    });
    Ok(opened)
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
    let (mut out, thumbs, plugins) = with_session(&cur, |s| {
        Ok((
            s.lib.import(&paths, folder.as_deref(), &projects)?,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
        ))
    })?;
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &mut out.items);
    if !jobs.is_empty() {
        std::thread::spawn(move || make_thumbs(&app, &plugins, jobs));
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

/// プラグインを取得先から入れて、開いているライブラリに記録する。入れたあとは、画面がライブラリを開き直す。
#[tauri::command]
async fn install_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    source: Source,
) -> Result<(), String> {
    let root = root_of(&cur)?;
    let m = plugin::install::install(&source, &plugin_dir(&app)?, &plugin::builtin_ids())?;
    record::update(&root, |r| {
        let e = r.plugins.entry(m.id).or_default();
        e.version = Some(m.version);
        e.source = Some(source);
    })
}

/// 記録してある取得先から入れ直す。
#[tauri::command]
async fn update_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
) -> Result<(), String> {
    let source = with_session(&cur, |s| Ok(s.plugins.source_of(&id)))?
        .ok_or_else(|| format!("{id} の取得先が記録されていない"))?;
    install_plugin(app, cur, source).await
}

/// 開いているライブラリの記録から外す。アプリからは消さない。
#[tauri::command]
async fn remove_plugin(cur: State<'_, Current>, id: String) -> Result<(), String> {
    let root = root_of(&cur)?;
    record::update(&root, |r| {
        r.plugins.remove(&id);
    })
}

/// プラグインを入れるフォルダか zip を選ぶ窓を出す。選ばなければ None。
#[tauri::command]
async fn pick_plugin(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    app.dialog()
        .file()
        .set_title("プラグインの zip を選ぶ")
        .add_filter("zip", &["zip"])
        .blocking_pick_file()
        .map(|p| p.into_path().map_err(|e| e.to_string()))
        .transpose()
}

#[tauri::command]
async fn set_plugin_setting(
    cur: State<'_, Current>,
    id: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    with_session(&cur, |s| s.plugins.set_setting(&id, &key, &value))
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
        s.runner.decode(&ext, &path)
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
#[tauri::command]
async fn plugin_call(
    cur: State<'_, Current>,
    id: String,
    part: Part,
    method: String,
    args: String,
) -> Result<String, String> {
    with_session(&cur, |s| {
        let (path, ext) = s.lib.asset(&id)?;
        let path = path.to_owned();
        s.runner.call_ui(&ext, part, &path, &method, &args)
    })
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
            .ok_or_else(|| format!("{plugin} を使っていない"))
    })
}

/// 組み込み UI が作ったサムネイル（本文が PNG）を置いて、画面へ知らせる。
/// 見出しの id は素材、width と height は素材の大きさ（わからなければ付けない）。
#[tauri::command]
async fn put_thumbnail(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("本文が PNG でない".into());
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let id = head("id").ok_or("id がない")?.to_owned();
    let num = |k: &str| head(k).and_then(|v| v.parse::<u32>().ok());
    let original = num("width").zip(num("height"));
    let (src, out) = with_session(&cur, |s| {
        let (path, ext) = s.lib.asset(&id)?;
        if s.plugins.handles(&ext, Part::Thumbnail) != Some(By::Ui) {
            return Err(format!("{ext} のサムネイルは組み込み UI が作るものでない"));
        }
        let out = thumb::path_for(&s.thumbs, path)
            .ok_or_else(|| format!("{} を読めない", path.display()))?;
        Ok((path.to_owned(), out))
    })?;
    let size = thumb::place(png, original, &out).map_err(|e| format!("{}: {e}", src.display()))?;
    tell_thumb(&app, &id, &out, size);
    Ok(())
}

/// 使っているプラグインのフォルダの中のファイルを返す。
fn plugin_file(
    app: &tauri::AppHandle,
    req: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let Some((id, rest)) = plugin::files::split(req.uri().path()) else {
        return plugin::files::serve(None, "");
    };
    let cur = app.state::<Current>();
    let dir = cur.0.lock().ok().and_then(|g| {
        g.as_ref()
            .and_then(|s| s.plugins.dir_of(&id).map(Path::to_owned))
    });
    plugin::files::serve(dir.as_deref(), &rest)
}

/// フォルダを選ぶ窓を出し、選んだフォルダを次から開くライブラリにする。選ばなければ false。
#[tauri::command]
async fn choose_library(app: tauri::AppHandle) -> Result<bool, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("ライブラリにするフォルダを選ぶ")
        .blocking_pick_folder()
    else {
        return Ok(false);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err(format!("{} はフォルダでない", dir.display()));
    }
    settings::set_library(&app, &dir)?;
    Ok(true)
}

#[tauri::command]
async fn save_item(cur: State<'_, Current>, id: String, patch: ItemPatch) -> Result<(), String> {
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
            put_thumbnail
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
