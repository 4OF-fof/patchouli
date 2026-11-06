use std::collections::HashSet;
use std::path::PathBuf;

use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::ai::{content, suggest};
use crate::background;
use crate::plugin::{self};
use crate::shell::{ghost, os, settings, tidy, web};
use crate::thumb;

use crate::plugin::ipc::{plugin_places, remove_plugins};

use crate::plugin::ipc::plugin_ids;
use crate::session::{Current, cache_dir, root_of, with};

#[tauri::command]
pub(crate) async fn developer(app: tauri::AppHandle) -> Result<settings::Developer, String> {
    settings::developer(&app)
}

#[tauri::command]
pub(crate) async fn set_developer(
    app: tauri::AppHandle,
    developer: settings::Developer,
) -> Result<(), String> {
    settings::set_developer(&app, &developer)
}

pub(crate) fn apply_app_settings(s: &settings::AppSettings) {
    thumb::set_large(s.thumb_size == settings::ThumbSize::Large);
    plugin::commands::set_fixed(s.command_paths.clone());
}

#[tauri::command]
pub(crate) async fn app_settings(app: tauri::AppHandle) -> Result<settings::AppSettings, String> {
    settings::app_settings(&app)
}

/// サムネイルの大きさを変えたときは、作り直すためにサムネイルのキャッシュを消す。
#[tauri::command]
pub(crate) async fn set_app_settings(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    settings: settings::AppSettings,
) -> Result<(), String> {
    let before = settings::app_settings(&app)?;
    let resize = before.thumb_size != settings.thumb_size;
    let root = if resize {
        let root = root_of(&cur)?;
        close_for_clearing(&app, &cur)?;
        Some(root)
    } else {
        None
    };
    settings::set_app_settings(&app, &settings)?;
    apply_app_settings(&settings);
    if let Some(root) = root {
        tidy::clear(&cache_dir(&app)?, &root, tidy::Kind::Thumbs)?;
    }
    Ok(())
}

/// キャッシュを消す前に、裏の仕事を止めて終わるのを待ち、ライブラリを閉じる。
fn close_for_clearing(app: &tauri::AppHandle, cur: &State<Current>) -> Result<(), String> {
    const LIMIT: std::time::Duration = std::time::Duration::from_secs(60);
    thumb::stop();
    content::stop(app);
    suggest::stop();
    if !background::wait(LIMIT) {
        return Err("実行中の処理が完了しないため、キャッシュを削除できませんでした".into());
    }
    let closed = cur.lock().take();
    if let Some(s) = closed {
        s.plugins.stop();
    }
    // 閉じる前に始まったものを待つ。閉じたあとは、新しく始まらない
    if !background::wait(LIMIT) {
        log::warn!("裏の処理が終わらないまま、キャッシュを消す");
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn pick_command(
    app: tauri::AppHandle,
    name: String,
) -> Result<Option<PathBuf>, String> {
    let Some(p) = app
        .dialog()
        .file()
        .set_title(format!("{name} の場所を選択"))
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    p.into_path().map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn pick_dev_path(
    app: tauri::AppHandle,
    repo: bool,
) -> Result<Option<PathBuf>, String> {
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
pub(crate) async fn reveal_item(cur: State<'_, Current>, id: String) -> Result<(), String> {
    let path = with(&cur, |l| Ok(l.path(&id)?.to_owned()))?;
    os::reveal(&path)
}

#[tauri::command]
pub(crate) async fn open_item_default(cur: State<'_, Current>, id: String) -> Result<(), String> {
    let path = with(&cur, |l| Ok(l.path(&id)?.to_owned()))?;
    os::open(&path)
}

#[tauri::command]
pub(crate) async fn item_path(cur: State<'_, Current>, id: String) -> Result<PathBuf, String> {
    with(&cur, |l| Ok(l.path(&id)?.to_owned()))
}

#[tauri::command]
pub(crate) async fn open_url(url: String) -> Result<(), String> {
    os::open_url(&web::parse(&url)?)
}

#[tauri::command]
pub(crate) async fn browser_show(
    app: tauri::AppHandle,
    pages: State<'_, web::Pages>,
    key: String,
    url: String,
    bounds: web::Bounds,
) -> Result<(), String> {
    web::show(&app, &pages, &key, &url, bounds)
}

#[tauri::command]
pub(crate) async fn browser_go(
    app: tauri::AppHandle,
    key: String,
    to: web::Go,
) -> Result<(), String> {
    web::go(&app, &key, to)
}

#[tauri::command]
pub(crate) async fn browser_layer(
    app: tauri::AppHandle,
    layers: Vec<web::Layer>,
) -> Result<(), String> {
    web::layer(&app, layers)
}

#[tauri::command]
pub(crate) async fn browser_hide(app: tauri::AppHandle, key: String) -> Result<(), String> {
    web::hide(&app, &key)
}

#[tauri::command]
pub(crate) async fn browser_close(
    app: tauri::AppHandle,
    pages: State<'_, web::Pages>,
    key: String,
) -> Result<(), String> {
    web::close(&app, &pages, &key)
}

#[tauri::command]
pub(crate) async fn browser_close_all(
    app: tauri::AppHandle,
    pages: State<'_, web::Pages>,
) -> Result<(), String> {
    web::close_all(&app, &pages)
}

#[tauri::command]
pub(crate) async fn ghost_show(
    app: tauri::AppHandle,
    page: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    ghost::show(&app, &page, x, y, w, h)
        .inspect_err(|e| log::warn!("つかんだタブの写しの窓を出せない: {e}"))
}

#[tauri::command]
pub(crate) async fn ghost_move(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    ghost::place(&app, x, y)
}

#[tauri::command]
pub(crate) async fn ghost_hide(app: tauri::AppHandle) -> Result<(), String> {
    ghost::hide(&app)
}

#[tauri::command]
pub(crate) async fn cache_usage(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<tidy::Usage, String> {
    Ok(tidy::usage(&cache_dir(&app)?, &root_of(&cur)?))
}

#[tauri::command]
pub(crate) async fn clear_cache(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    kind: tidy::Kind,
) -> Result<(), String> {
    let root = root_of(&cur)?;
    let unused = match kind {
        tidy::Kind::All => unused_plugins_of(&app, &cur)?,
        _ => Vec::new(),
    };
    close_for_clearing(&app, &cur)?;
    tidy::clear(&cache_dir(&app)?, &root, kind)?;
    remove_plugins(unused)
}

pub(crate) fn unused_plugins_of(
    app: &tauri::AppHandle,
    cur: &State<Current>,
) -> Result<Vec<(tidy::Unused, PathBuf)>, String> {
    let current = root_of(cur).ok();
    let recent = settings::recent(app)?;
    let mut out = Vec::new();
    for (dir, users) in plugin_places(app, current.as_deref(), &recent)? {
        let used: HashSet<String> = users
            .iter()
            .flat_map(|u| {
                plugin_ids(u).unwrap_or_else(|| {
                    recent
                        .iter()
                        .find(|r| &r.path == u)
                        .map(|r| r.plugins.clone())
                        .unwrap_or_default()
                })
            })
            .collect();
        out.extend(tidy::unused(&dir, &used));
    }
    out.sort_by(|a, b| a.0.name.cmp(&b.0.name));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn unused_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<Vec<tidy::Unused>, String> {
    Ok(unused_plugins_of(&app, &cur)?
        .into_iter()
        .map(|(u, _)| u)
        .collect())
}

#[tauri::command]
pub(crate) async fn remove_unused_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<(), String> {
    remove_plugins(unused_plugins_of(&app, &cur)?)
}
