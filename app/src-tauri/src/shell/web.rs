use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use tauri::webview::PageLoadEvent;
use tauri::webview::{NewWindowFeatures, NewWindowResponse, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
    WebviewWindowBuilder, Wry,
};

/// 本体の画面の WebView。ほかの WebView（外のページ）からは、本体の関数とプラグインのファイルを使わせない。
pub const MAIN: &str = "main";
/// 本体の画面が window.open で開く、タブを出す別のウィンドウの label の頭。中身は本体の画面の JS が描く。
pub const POPOUT: &str = "popout-";

static POPOUTS: AtomicU64 = AtomicU64::new(0);

/// 本体の画面を読み込んでいる WebView か。外のページは含めない。
pub fn ours(label: &str) -> bool {
    label == MAIN || label.starts_with(POPOUT)
}

/// 本体の画面の window.open。空のページだけを開き、本体の画面から触れるよう、開いた側とつないだまま返す。
pub fn popout(app: &AppHandle, url: Url, features: NewWindowFeatures) -> NewWindowResponse<Wry> {
    if url.as_str() != "about:blank" {
        return NewWindowResponse::Deny;
    }
    let label = format!("{POPOUT}{}", POPOUTS.fetch_add(1, Ordering::Relaxed));
    // 枠は本体の画面が描くので、OS の枠は外す
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .window_features(features)
        .title("Patchouli")
        .decorations(false)
        .on_document_title_changed(|w, title| {
            if let Err(e) = w.set_title(&title) {
                log::warn!("別のウィンドウの名前を変えられない: {e}");
            }
        })
        .build();
    match built {
        Ok(window) => {
            // 開いた順に label を知らせる。本体の画面は、これで窓のボタンとドラッグをその窓に向ける
            if let Err(e) = app.emit_to(MAIN, "popout", &label) {
                log::warn!("別のウィンドウの名前を知らせられない: {e}");
            }
            NewWindowResponse::Create { window }
        }
        Err(e) => {
            log::warn!("別のウィンドウを開けない: {e}");
            NewWindowResponse::Deny
        }
    }
}

/// 一度に取ってこられる大きさ。
const LIMIT: u64 = 16 << 20;
const TIMEOUT: Duration = Duration::from_secs(20);

pub fn parse(url: &str) -> Result<Url, String> {
    let u = Url::parse(url).map_err(|e| format!("URL「{url}」が正しくありません：{e}"))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(format!("http か https の URL ではありません：{url}"));
    }
    Ok(u)
}

/// 取ってきたものの見出し。url はリダイレクトをたどったあとのもの。
#[derive(Serialize)]
pub struct Head {
    pub status: u16,
    pub url: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// たどるリダイレクトの数。
const REDIRECTS: usize = 5;

/// 取ってきたもの。頭の 4 バイトが見出しの JSON の長さで、JSON、中身と続く。
pub fn fetch(url: &Url, allow: impl Fn(&Url) -> Result<(), String>) -> Result<Vec<u8>, String> {
    let (head, body) = get(url, allow)?;
    crate::framed::join(&head, &body)
}

/// GET で取ってくる。リダイレクトは 1 回ずつたどり、行き先ごとに allow で確かめる。
pub fn get(
    url: &Url,
    allow: impl Fn(&Url) -> Result<(), String>,
) -> Result<(Head, Vec<u8>), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent(concat!("Patchouli/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let err = |e: ureq::Error| format!("{url}: {e}");
    let mut at = url.clone();
    let mut hops = 0;
    let mut res = loop {
        let res = agent.get(at.as_str()).call().map_err(err)?;
        let location = res
            .status()
            .is_redirection()
            .then(|| res.headers().get("location"))
            .flatten()
            .and_then(|v| v.to_str().ok());
        let Some(location) = location else { break res };
        if hops == REDIRECTS {
            return Err(format!("{url}: リダイレクトが多すぎます"));
        }
        hops += 1;
        let next = at
            .join(location)
            .map_err(|e| format!("{url}: リダイレクト先が正しくありません：{e}"))
            .and_then(|u| parse(u.as_str()))?;
        allow(&next).map_err(|e| format!("{url} のリダイレクト先を取りに行けません：{e}"))?;
        at = next;
    };
    let head = Head {
        status: res.status().as_u16(),
        url: at.to_string(),
        kind: res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned),
    };
    let body = res
        .body_mut()
        .with_config()
        .limit(LIMIT)
        .read_to_vec()
        .map_err(err)?;
    Ok((head, body))
}

/// タブの中に出す外のページの位置と大きさ（CSS の px）。
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl From<Bounds> for Rect {
    fn from(b: Bounds) -> Rect {
        Rect {
            position: LogicalPosition::new(b.x, b.y).into(),
            size: LogicalSize::new(b.width.max(1.0), b.height.max(1.0)).into(),
        }
    }
}

/// 開いた外のページ（WebView の label → 開いた URL）。
#[derive(Default)]
pub struct Pages(Mutex<HashMap<String, Url>>);

fn label_of(key: &str) -> Result<String, String> {
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("外のページの名前が正しくありません：{key}"));
    }
    Ok(format!("web-{key}"))
}

/// key の外のページを bounds に出す。まだなければ作り、url が前に開いたものと違えば開き直す。
pub fn show(
    app: &AppHandle,
    pages: &Pages,
    key: &str,
    url: &str,
    bounds: Bounds,
) -> Result<(), String> {
    let url = parse(url)?;
    let label = label_of(key)?;
    let mut opened = pages.0.lock().map_err(|e| e.to_string())?;
    let e = |e: tauri::Error| e.to_string();
    if let Some(wv) = app.get_webview(&label) {
        wv.set_bounds(bounds.into()).map_err(e)?;
        if opened.get(&label) != Some(&url) {
            wv.navigate(url.clone()).map_err(e)?;
            opened.insert(label, url);
        }
        return wv.show().map_err(e);
    }
    let win = app
        .get_window(MAIN)
        .ok_or("本体のウィンドウが見つかりません")?;
    let to = app.clone();
    let popup_key = key.to_owned();
    // 新しいウィンドウは開かず、本体に知らせて既定のブラウザで開くかを尋ねる
    let b = WebviewBuilder::new(&label, WebviewUrl::External(url.clone())).on_new_window(
        move |url, _| {
            let popup = Popup {
                key: popup_key.clone(),
                url: url.to_string(),
            };
            if let Err(e) = to.emit_to(MAIN, "browser-popup", popup) {
                eprintln!("外のページが開こうとした URL を知らせられません：{e}");
            }
            NewWindowResponse::Deny
        },
    );
    // Windows では、履歴が変わったときに WebView2 から URL と戻れるかを読む
    #[cfg(not(windows))]
    let b = b.on_page_load(|wv, p| {
        if p.event() != PageLoadEvent::Started {
            return;
        }
        let Some(key) = wv.label().strip_prefix("web-") else {
            return;
        };
        let moved = Moved {
            key: key.to_owned(),
            url: p.url().to_string(),
            back: true,
            forward: true,
        };
        tell(&wv, moved);
    });
    let wv = win
        .add_child(
            b,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(e)?;
    #[cfg(windows)]
    {
        watch(&wv, key.to_owned()).map_err(e)?;
        layer::sink(app, &wv).map_err(e)?;
    }
    #[cfg(not(windows))]
    let _ = wv;
    opened.insert(label, url);
    Ok(())
}

/// 外のページの中で開いたページと、戻れるか・進めるか。
#[derive(Clone, Serialize)]
struct Moved {
    key: String,
    url: String,
    back: bool,
    forward: bool,
}

/// 外のページが新しいウィンドウで開こうとした URL。
#[derive(Clone, Serialize)]
struct Popup {
    key: String,
    url: String,
}

fn tell(wv: &Webview, moved: Moved) {
    if let Err(e) = wv.emit_to(MAIN, "browser-url", moved) {
        eprintln!("外のページの URL を知らせられません：{e}");
    }
}

#[cfg(windows)]
fn watch(wv: &Webview, key: String) -> tauri::Result<()> {
    use webview2_com::{HistoryChangedEventHandler, take_pwstr};
    use windows_core::{BOOL, PWSTR};
    let to = wv.clone();
    wv.with_webview(move |pv| {
        let handler = HistoryChangedEventHandler::create(Box::new(move |core, _| {
            let Some(core) = core else {
                return Ok(());
            };
            let mut src = PWSTR::null();
            let mut back = BOOL::default();
            let mut forward = BOOL::default();
            // SAFETY: WebView2 の UI スレッドで、渡された ICoreWebView2 に問い合わせるだけ
            unsafe {
                core.Source(&mut src)?;
                core.CanGoBack(&mut back)?;
                core.CanGoForward(&mut forward)?;
            }
            let moved = Moved {
                key: key.clone(),
                url: take_pwstr(src),
                back: back.as_bool(),
                forward: forward.as_bool(),
            };
            tell(&to, moved);
            Ok(())
        }));
        let mut token = 0;
        // SAFETY: with_webview は UI スレッドで呼ばれる
        let added = unsafe {
            pv.controller()
                .CoreWebView2()
                .and_then(|c| c.add_HistoryChanged(&handler, &mut token))
        };
        if let Err(e) = added {
            eprintln!("外のページの履歴を見張れません：{e}");
        }
    })
}

/// 本体の画面のうち、外のページを見せる穴（hole）と、穴の上に描く表示。CSS の px で、描く順に並べる。
#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Layer {
    hole: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
}

/// 本体の画面に穴を開ける。Windows のほかは、外のページがいつも本体の画面の上に出る。
pub fn layer(app: &AppHandle, layers: Vec<Layer>) -> Result<(), String> {
    #[cfg(windows)]
    return layer::cut(app, layers).map_err(|e| e.to_string());
    #[cfg(not(windows))]
    {
        let _ = (app, layers);
        Ok(())
    }
}

/// 外のページは本体の画面の下に置き、本体の画面の WebView を入れたウィンドウに
/// ウィンドウの領域（SetWindowRgn）で穴を開けて見せる。穴の上に重ねる表示の所は領域に戻すので、
/// 本体の画面の表示がそのままページの前に出る。領域の外のクリックは下のページに届く。
#[cfg(windows)]
mod layer {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicIsize, Ordering};

    use tauri::webview::PlatformWebview;
    use tauri::{AppHandle, Manager, Webview};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, HRGN, RGN_DIFF, RGN_OR, SetWindowRgn,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SetWindowPos,
    };

    use super::{Layer, MAIN};

    /// 本体の画面の WebView を入れたウィンドウ。
    static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);

    /// WebView2 を入れたウィンドウ（wry が WebView ごとに作る）。
    fn container(pv: &PlatformWebview) -> Option<HWND> {
        let mut raw: *mut c_void = std::ptr::null_mut();
        // SAFETY: UI スレッドで、HWND を 1 つ書いてもらうだけ。HWND は *mut c_void と同じ並び
        unsafe {
            pv.controller()
                .ParentWindow(std::ptr::from_mut(&mut raw).cast())
        }
        .ok()?;
        (!raw.is_null()).then_some(raw)
    }

    fn remember_main(app: &AppHandle) -> tauri::Result<()> {
        let main = app.get_webview(MAIN).ok_or(tauri::Error::WebviewNotFound)?;
        main.with_webview(|pv| {
            if let Some(h) = container(&pv) {
                MAIN_HWND.store(h as isize, Ordering::Relaxed);
            }
        })
    }

    /// 外のページを、本体の画面のすぐ下に置く。あとから出したページほど上になる。
    pub fn sink(app: &AppHandle, page: &Webview) -> tauri::Result<()> {
        remember_main(app)?;
        page.with_webview(|pv| {
            let main = MAIN_HWND.load(Ordering::Relaxed) as HWND;
            let Some(h) = container(&pv) else {
                return;
            };
            if main.is_null() {
                return;
            }
            // SAFETY: どちらもこのプロセスが作った、同じ親の子ウィンドウ
            unsafe {
                SetWindowPos(
                    h,
                    main,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                )
            };
        })
    }

    pub fn cut(app: &AppHandle, layers: Vec<Layer>) -> tauri::Result<()> {
        let main = app.get_webview(MAIN).ok_or(tauri::Error::WebviewNotFound)?;
        let scale = main.window().scale_factor()?;
        main.with_webview(move |pv| {
            let Some(h) = container(&pv) else {
                return;
            };
            MAIN_HWND.store(h as isize, Ordering::Relaxed);
            let px = |v: f64| (v * scale).round() as i32;
            // SAFETY: 作った領域は SetWindowRgn に渡すか、ここで消す
            unsafe {
                if !layers.iter().any(|l| l.hole) {
                    SetWindowRgn(h, std::ptr::null_mut(), 1);
                    return;
                }
                let all = CreateRectRgn(0, 0, i16::MAX.into(), i16::MAX.into());
                for l in &layers {
                    let r = if l.hole {
                        CreateRectRgn(px(l.x), px(l.y), px(l.x + l.width), px(l.y + l.height))
                    } else {
                        cover(l, scale)
                    };
                    CombineRgn(all, all, r, if l.hole { RGN_DIFF } else { RGN_OR });
                    DeleteObject(r);
                }
                SetWindowRgn(h, all, 1);
            }
        })
    }

    /// 重ねる表示の領域。領域は画素の単位でしか切れないので、角の丸みは少しでもかかる画素まで含め、
    /// 本体の画面が描いたなめらかな縁がそのまま見えるようにする。
    unsafe fn cover(l: &Layer, scale: f64) -> HRGN {
        let (x0, y0) = (l.x * scale, l.y * scale);
        let (x1, y1) = ((l.x + l.width) * scale, (l.y + l.height) * scale);
        let r = (l.radius * scale)
            .min((x1 - x0) / 2.0)
            .min((y1 - y0) / 2.0)
            .max(0.0);
        let (top, bottom) = (y0 + r, y1 - r);
        let span = |y: i32| {
            let (a, b) = (f64::from(y), f64::from(y + 1));
            let dy = if b < top {
                top - b
            } else if a > bottom {
                a - bottom
            } else {
                0.0
            };
            let dx = r - (r * r - dy * dy).max(0.0).sqrt();
            ((x0 + dx).floor() as i32, (x1 - dx).ceil() as i32)
        };
        // SAFETY: 作った領域は呼び出し元が消すか SetWindowRgn に渡す
        unsafe {
            let out = CreateRectRgn(0, 0, 0, 0);
            let (first, last) = (y0.floor() as i32, y1.ceil() as i32);
            let mut from = first;
            let mut run = span(first);
            for y in first + 1..=last {
                let s = if y < last { span(y) } else { (0, 0) };
                if s == run && y < last {
                    continue;
                }
                let part = CreateRectRgn(run.0, from, run.1, y);
                CombineRgn(out, out, part, RGN_OR);
                DeleteObject(part);
                (from, run) = (y, s);
            }
            out
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Go {
    Back,
    Forward,
    Reload,
}

pub fn go(app: &AppHandle, key: &str, to: Go) -> Result<(), String> {
    let Some(wv) = app.get_webview(&label_of(key)?) else {
        return Ok(());
    };
    #[cfg(windows)]
    if !matches!(to, Go::Reload) {
        return wv
            .with_webview(move |pv| {
                // SAFETY: with_webview は UI スレッドで呼ばれる
                let done = unsafe {
                    pv.controller().CoreWebView2().and_then(|c| match to {
                        Go::Back => c.GoBack(),
                        _ => c.GoForward(),
                    })
                };
                if let Err(e) = done {
                    eprintln!("外のページの履歴を移れません：{e}");
                }
            })
            .map_err(|e| e.to_string());
    }
    match to {
        Go::Back => wv.eval("history.back()"),
        Go::Forward => wv.eval("history.forward()"),
        Go::Reload => wv.reload(),
    }
    .map_err(|e| e.to_string())
}

pub fn hide(app: &AppHandle, key: &str) -> Result<(), String> {
    match app.get_webview(&label_of(key)?) {
        Some(wv) => wv.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn close(app: &AppHandle, pages: &Pages, key: &str) -> Result<(), String> {
    let label = label_of(key)?;
    pages.0.lock().map_err(|e| e.to_string())?.remove(&label);
    match app.get_webview(&label) {
        Some(wv) => wv.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// 本体の画面を読み直したときに、前の画面が開いた外のページと、タブを出す別のウィンドウを閉じる。
pub fn close_all(app: &AppHandle, pages: &Pages) -> Result<(), String> {
    pages.0.lock().map_err(|e| e.to_string())?.clear();
    for (label, wv) in app.webviews() {
        if !ours(&label) {
            wv.close().map_err(|e| e.to_string())?;
        }
    }
    close_popouts(app);
    Ok(())
}

pub fn close_popouts(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with(POPOUT)
            && let Err(e) = w.close()
        {
            log::warn!("タブのウィンドウを閉じられない: {label}: {e}");
        }
    }
}
