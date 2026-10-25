//! 外のプラグインの画面（`plugin://localhost/<id>/<パス>`）を返す。画面は隔離した iframe で開く。

use std::fs;
use std::path::Path;

use tauri::http::{Response, StatusCode, header};

/// URL のパスの先頭（プラグインの id）と、残り（プラグインのフォルダの中のパス）。
pub fn split(uri_path: &str) -> Option<(String, String)> {
    let path = percent_decode(uri_path.trim_start_matches('/'));
    let (id, rest) = path.split_once('/')?;
    Some((id.to_owned(), rest.to_owned()))
}

/// dir（使っているプラグインのフォルダ）の中の rest を返す。フォルダの外や、ないものは 404。
pub fn serve(dir: Option<&Path>, rest: &str) -> Response<Vec<u8>> {
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap()
    };
    let Some(dir) = dir else { return not_found() };
    let file = dir.join(rest);
    let inside = fs::canonicalize(&file)
        .ok()
        .zip(fs::canonicalize(dir).ok())
        .is_some_and(|(f, d)| f.starts_with(d) && f.is_file());
    let Some(body) = inside.then(|| fs::read(&file).ok()).flatten() else {
        return not_found();
    };
    let me = "http://plugin.localhost plugin://localhost";
    Response::builder()
        .header(header::CONTENT_TYPE, mime_of(&file))
        // 外への通信と、プラグインのフォルダの外からの読み込みを止める
        .header(
            header::CONTENT_SECURITY_POLICY,
            format!(
                "default-src 'none'; script-src {me} 'unsafe-inline' 'wasm-unsafe-eval'; \
                 style-src {me} 'unsafe-inline'; img-src {me} data: blob:; \
                 media-src {me} data: blob:; font-src {me} data:"
            ),
        )
        // iframe は origin を持たない（sandbox）ので、module の script も読めるようにする
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap()
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && let Some(h) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(h);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn mime_of(p: &Path) -> &'static str {
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}
