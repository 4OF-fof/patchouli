//! タブをドラッグして窓の外へ運んでいるあいだ、つかんだタブを描いてカーソルに付けて動かす小さな窓。

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

use crate::shell::web::MAIN;

const LABEL: &str = "drag-ghost";

/// 本体の画面と同じオリジンの ghost.html に、描くもの（page）を # の後ろに付けたもの。
/// 同じオリジンなので、本体の CSS とフォントをそのまま読める
fn url_of(app: &AppHandle, page: &str) -> Result<Url, String> {
    let main = app.get_webview_window(MAIN).ok_or("本体の窓がありません")?;
    let base = main.url().map_err(|e| e.to_string())?;
    let mut url = base.join("/ghost.html").map_err(|e| e.to_string())?;
    url.set_fragment(Some(page));
    Ok(url)
}

/// page を描いた窓を、画面の上の (x, y) に w × h で出す。2 回目からは、前に作った窓を使い回す。
pub fn show(app: &AppHandle, page: &str, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let url = url_of(app, page)?;
    if let Some(win) = app.get_webview_window(LABEL) {
        win.navigate(url).map_err(|e| e.to_string())?;
        win.set_size(LogicalSize::new(w, h))
            .map_err(|e| e.to_string())?;
        win.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        return win.show().map_err(|e| e.to_string());
    }
    // 出しても、ドラッグしている窓からフォーカスとカーソルを取らない。タブの角と影を描くので、透明にする
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .inner_size(w, h)
        .position(x, y)
        .build()
        .map_err(|e| e.to_string())?;
    win.set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())
}

pub fn place(app: &AppHandle, x: f64, y: f64) -> Result<(), String> {
    match app.get_webview_window(LABEL) {
        Some(win) => win
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    match app.get_webview_window(LABEL) {
        Some(win) => win.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// 隠した窓が残ると、本体の窓を閉じてもアプリが終わらないので、本体の窓と一緒に閉じる。
pub fn close(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.destroy();
    }
}
