//! タスクトレイのアイコン。ウィンドウを閉じても、裏で動き続けられるようにする。

use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::shell::web::{MAIN, POPOUT};
use crate::shell::{settings, toast};

/// 画面が書きかけのものを保存し終えるのを待つ長さ。過ぎたら、待たずに終える。
const QUIT_WAIT: Duration = Duration::from_secs(5);

/// 本体のウィンドウを開かずに起動する引数。CLI がアプリを起動するときに付ける。
pub const BACKGROUND: &str = "--background";

pub fn background() -> bool {
    std::env::args().any(|a| a == BACKGROUND)
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "ウィンドウを表示", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Patchouli")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "show" => show_main(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = e
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn windows(app: &AppHandle) -> impl Iterator<Item = tauri::WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label == MAIN || label.starts_with(POPOUT) && !toast::is_toast(label))
        .map(|(_, w)| w)
}

pub fn show_main(app: &AppHandle) {
    for w in windows(app) {
        if let Err(e) = w.show() {
            log::warn!("ウィンドウを出せない: {}: {e}", w.label());
        }
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn hide_main(app: &AppHandle) {
    for w in windows(app) {
        if let Err(e) = w.hide() {
            log::warn!("ウィンドウを隠せない: {}: {e}", w.label());
        }
    }
}

/// 画面に保存を済ませてもらってから終える。画面が応えなければ、待たずに終える。
pub fn quit(app: &AppHandle) {
    if app.emit_to(MAIN, "app-quit", ()).is_err() {
        app.exit(0);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_WAIT);
        app.exit(0);
    });
}

/// 本体のウィンドウを閉じようとしたとき。トレイに残すなら隠して true を返す。
#[tauri::command]
pub(crate) async fn close_to_tray(app: AppHandle) -> bool {
    let keep = settings::app_settings(&app).is_ok_and(|s| s.close_to_tray);
    if keep {
        hide_main(&app);
    }
    keep
}

#[tauri::command]
pub(crate) async fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// トレイに隠した本体のウィンドウを出す。トーストから項目を開くときに使う。
#[tauri::command]
pub(crate) async fn show_app(app: AppHandle) {
    show_main(&app);
}
