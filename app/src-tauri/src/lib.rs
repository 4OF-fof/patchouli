pub mod import;
pub mod library;
pub mod note;
mod settings;
pub mod thumb;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use library::{ItemPatch, Kind, Library, LibraryState, Opened, StoredItem, StoredProject};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 開いているライブラリと、そのサムネイルの置き場所。開く前は None。
#[derive(Default)]
struct Current(Mutex<Option<Session>>);

struct Session {
    lib: Library,
    thumbs: PathBuf,
}

/// 開くライブラリの場所。設定で選んだ場所か、まだ選んでいなければ、開発中は動作確認用のライブラリを開く。
fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = settings::library(app)? {
        return Ok(p);
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dev-library"));
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

/// 画像のサムネイルのうち、できているものは thumb に入れ、まだのものは作る仕事にする。
/// 返すのは、作る仕事、いまの画像すべてのサムネイルの場所、すべての画像の場所を決められたか。
fn plan_thumbs(thumbs: &Path, items: &mut [StoredItem]) -> (Vec<thumb::Job>, Vec<PathBuf>, bool) {
    let mut jobs = Vec::new();
    let mut current = Vec::new();
    let mut all = true;
    for it in items.iter_mut().filter(|i| i.kind == Kind::Image) {
        let Some(out) = thumb::path_for(thumbs, &it.file) else {
            all = false;
            continue;
        };
        current.push(out.clone());
        if out.exists() {
            it.thumb = Some(out);
        } else {
            jobs.push(thumb::Job {
                id: it.id.clone(),
                src: it.file.clone(),
                out,
                mtime: it.mtime,
            });
        }
    }
    (jobs, current, all)
}

/// 裏でサムネイルを作り、できたものから画面へ知らせる。
fn make_thumbs(app: &tauri::AppHandle, jobs: Vec<thumb::Job>) {
    thumb::make_all(jobs, |j| {
        let _ = app.emit(
            "thumbnail",
            ThumbReady {
                id: &j.id,
                file: &j.out,
            },
        );
    })
}

#[tauri::command]
async fn open_library(app: tauri::AppHandle, cur: State<'_, Current>) -> Result<Opened, String> {
    let (lib, mut opened) = Library::open(&library_root(&app)?)?;
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
    let (jobs, current, all) = plan_thumbs(&thumbs, &mut opened.items);
    let all_found = all && opened.problems.is_empty();
    let dir = thumbs.clone();
    std::thread::spawn(move || {
        thumb::prune(&dir, &current, all_found);
        make_thumbs(&app, jobs);
    });
    *cur.0.lock().map_err(|e| e.to_string())? = Some(Session { lib, thumbs });
    Ok(opened)
}

/// 落とそうとしているものの中身を数える。
#[tauri::command]
async fn inspect_drop(
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
) -> Result<import::DropInfo, String> {
    let g = cur.0.lock().map_err(|e| e.to_string())?;
    Ok(import::inspect(&paths, g.as_ref().map(|s| s.lib.root())))
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
    let (mut out, thumbs) = with_session(&cur, |s| {
        Ok((
            s.lib.import(&paths, folder.as_deref(), &projects)?,
            s.thumbs.clone(),
        ))
    })?;
    let (jobs, _, _) = plan_thumbs(&thumbs, &mut out.items);
    if !jobs.is_empty() {
        std::thread::spawn(move || make_thumbs(&app, jobs));
    }
    Ok(out)
}

/// サムネイルができたときに画面へ送る知らせ。
#[derive(Clone, Serialize)]
struct ThumbReady<'a> {
    id: &'a str,
    file: &'a Path,
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
        .invoke_handler(tauri::generate_handler![
            open_library,
            choose_library,
            inspect_drop,
            import_files,
            save_item,
            save_state,
            create_note,
            create_project,
            save_project
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
