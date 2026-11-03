use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use tauri::webview::PageLoadEvent;
use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
};
use ureq::ResponseExt;

/// 本体の画面の WebView。ほかの WebView（外のページ）からは、本体の関数とプラグインのファイルを使わせない。
pub const MAIN: &str = "main";

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

#[derive(Serialize)]
struct Head {
    status: u16,
    url: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
}

/// 取ってきたもの。頭の 4 バイトが見出しの JSON の長さで、JSON、中身と続く。
pub fn fetch(url: &Url) -> Result<Vec<u8>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .http_status_as_error(false)
        .user_agent(concat!("Patchouli/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let err = |e: ureq::Error| format!("{url}: {e}");
    let mut res = agent.get(url.as_str()).call().map_err(err)?;
    let head = Head {
        status: res.status().as_u16(),
        url: res.get_uri().to_string(),
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
    let head = serde_json::to_vec(&head).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(4 + head.len() + body.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&body);
    Ok(out)
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
    let b = WebviewBuilder::new(&label, WebviewUrl::External(url.clone()));
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
    watch(&wv, key.to_owned()).map_err(e)?;
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

/// 本体の画面を読み直したときに、前の画面が開いた外のページを閉じる。
pub fn close_all(app: &AppHandle, pages: &Pages) -> Result<(), String> {
    pages.0.lock().map_err(|e| e.to_string())?.clear();
    for (label, wv) in app.webviews() {
        if label != MAIN {
            wv.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
