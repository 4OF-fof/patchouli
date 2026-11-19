//! 拡張機能などが保存したものを知らせるトーストの窓。本体の画面の JS が window.open で開き、中身を描く。
//! ほかのアプリを使っているあいだに出るので、フォーカスを取らずに、カーソルのある画面の右下に最前面で出す。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use tauri::webview::NewWindowFeatures;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalRect, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::shell::web::POPOUT;

/// 画面の端からの間。トーストの影は、窓の中で本体の画面が描く。
const MARGIN: f64 = 8.0;

static EXPECTED: AtomicBool = AtomicBool::new(false);
static SEQ: AtomicU64 = AtomicU64::new(0);

/// いまのトーストの窓と、出した画面。
#[derive(Clone)]
struct Shown {
    label: String,
    area: PhysicalRect<i32, u32>,
    scale: f64,
}

static CURRENT: Mutex<Option<Shown>> = Mutex::new(None);

fn current() -> MutexGuard<'static, Option<Shown>> {
    CURRENT.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn is_toast(label: &str) -> bool {
    label.starts_with(&format!("{POPOUT}toast"))
}

/// 次の window.open で開く窓を、トーストの窓にする。
#[tauri::command]
pub(crate) fn expect_toast() {
    EXPECTED.store(true, Ordering::SeqCst);
}

pub fn take_expected() -> bool {
    EXPECTED.swap(false, Ordering::SeqCst)
}

/// カーソルのある画面の作業領域と倍率。分からなければ、主の画面のもの。
fn area(app: &AppHandle) -> Option<(PhysicalRect<i32, u32>, f64)> {
    let at = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    let m = at.or_else(|| app.primary_monitor().ok().flatten())?;
    Some((*m.work_area(), m.scale_factor()))
}

/// 作業領域の右下に w × h の窓を置くときの、左上の位置（論理座標）。
fn corner(area: &PhysicalRect<i32, u32>, scale: f64, w: f64, h: f64) -> (f64, f64) {
    let right = (area.position.x as f64 + area.size.width as f64) / scale;
    let bottom = (area.position.y as f64 + area.size.height as f64) / scale;
    (right - w - MARGIN, bottom - h - MARGIN)
}

pub fn build(
    app: &AppHandle,
    url: Url,
    features: NewWindowFeatures,
) -> tauri::Result<WebviewWindow> {
    let label = format!("{POPOUT}toast-{}", SEQ.fetch_add(1, Ordering::Relaxed));
    let size = features.size();
    let (w, h) = size.map_or((400.0, 120.0), |s| (s.width, s.height));
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .window_features(features)
        .title("Patchouli")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .inner_size(w, h);
    let found = area(app);
    if let Some((a, scale)) = &found {
        let (x, y) = corner(a, *scale, w, h);
        builder = builder.position(x, y);
    }
    let win = builder.build()?;
    if let Some((area, scale)) = found {
        *current() = Some(Shown { label, area, scale });
    }
    Ok(win)
}

/// トーストの中身の大きさが変わったら、右下に付けたまま窓の大きさを合わせる。
#[tauri::command]
pub(crate) async fn place_toast(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(s) = current().clone() else {
        return Ok(());
    };
    let Some(win) = app.get_webview_window(&s.label) else {
        return Ok(());
    };
    let (x, y) = corner(&s.area, s.scale, width, height);
    win.set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    win.set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}
