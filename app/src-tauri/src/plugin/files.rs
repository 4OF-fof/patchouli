use std::fs;
use std::path::Path;

use tauri::http::{Response, StatusCode, header};

pub fn split(uri_path: &str) -> Option<(String, String)> {
    let path = percent_decode(uri_path.trim_start_matches('/'));
    let (id, rest) = path.split_once('/')?;
    Some((id.to_owned(), rest.to_owned()))
}

/// 「/」区切りのパス rel を、「.」と空の部分を除いて並べ直す。「..」があれば None。
pub fn normal(rel: &str) -> Option<String> {
    let parts: Vec<&str> = rel
        .split(['/', '\\'])
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    (!parts.is_empty() && !parts.contains(&"..")).then(|| parts.join("/"))
}

/// dir（外のプラグインのフォルダ）の中の rest。フォルダの外や、ないものは None。
pub fn read(dir: &Path, rest: &str) -> Option<Vec<u8>> {
    let file = dir.join(rest);
    let inside = fs::canonicalize(&file)
        .ok()
        .zip(fs::canonicalize(dir).ok())
        .is_some_and(|(f, d)| f.starts_with(d) && f.is_file());
    inside.then(|| fs::read(&file).ok()).flatten()
}

pub fn serve(rest: &str, body: Option<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(body) = body else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap();
    };
    Response::builder()
        .header(header::CONTENT_TYPE, mime_of(Path::new(rest)))
        // 本体の画面とは origin が違うので、module の script として読めるようにする
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
