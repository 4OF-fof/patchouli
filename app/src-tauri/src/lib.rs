pub mod library;
pub mod note;
mod settings;
pub mod thumb;

use std::path::PathBuf;
use std::sync::Mutex;

use library::{ItemPatch, Kind, Library, LibraryState, Opened, StoredItem, StoredProject};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// 開いているライブラリ。開く前は None。
#[derive(Default)]
struct Current(Mutex<Option<Library>>);

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
    let mut g = cur.0.lock().map_err(|e| e.to_string())?;
    let lib = g.as_mut().ok_or("ライブラリを開いていない")?;
    f(lib)
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
    let mut jobs = Vec::new();
    let mut current = Vec::new();
    let mut all_found = opened.problems.is_empty();
    for it in opened.items.iter_mut().filter(|i| i.kind == Kind::Image) {
        let Some(out) = thumb::path_for(&thumbs, &it.file) else {
            all_found = false;
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
    std::thread::spawn(move || {
        thumb::prune(&thumbs, &current, all_found);
        if !jobs.is_empty() {
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
    });
    *cur.0.lock().map_err(|e| e.to_string())? = Some(lib);
    Ok(opened)
}

/// サムネイルができたときに画面へ送る知らせ。
#[derive(Clone, Serialize)]
struct ThumbReady<'a> {
    id: &'a str,
    file: &'a std::path::Path,
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
