use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{Manager, State};

use crate::library::shortcut;
use crate::plugin::ipc::{ScriptCall, Target};
use crate::plugin::{self, CodeOut, Part, Reads, Runner, UiOwner, ViewOut};
use crate::session::{Current, with, with_session};
use crate::shell::web;
use crate::thumb;

#[tauri::command]
pub(crate) async fn item_view(
    cur: State<'_, Current>,
    id: String,
) -> Result<Option<ViewOut>, String> {
    let t = Target::of(&cur, &id)?;
    if t.plugins.by_link(&t.ext, Part::View) {
        return Ok(shortcut::url_of(&t.path).map(|url| ViewOut::Link { url }));
    }
    Ok(t.plugins.view(&t.ext))
}

#[derive(Serialize)]
pub(crate) struct Detail {
    label: String,
    value: String,
}

#[derive(Serialize)]
pub(crate) struct Details {
    size: u64,
    rows: Vec<Detail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    script: Option<ScriptCall>,
    /// ショートカットが指す URL。URL ごとに受け持つものが行を作る。
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

pub(crate) fn rows_of(rows: Vec<(String, String)>) -> Vec<Detail> {
    rows.into_iter()
        .map(|(label, value)| Detail { label, value })
        .collect()
}

/// スクリプトが受け持つときは、行を作らずに script を返す（画面が作る）。
#[tauri::command]
pub(crate) async fn item_details(cur: State<'_, Current>, id: String) -> Result<Details, String> {
    let t = Target::of(&cur, &id)?;
    let size = std::fs::metadata(&t.path)
        .map_err(|e| format!("{}: {e}", t.path.display()))?
        .len();
    if t.plugins.by_link(&t.ext, Part::Details) {
        return Ok(Details {
            size,
            rows: Vec::new(),
            script: None,
            url: shortcut::url_of(&t.path),
        });
    }
    if let Some(ui) = t.plugins.ui_of(&t.ext, Part::Details) {
        return Ok(Details {
            size,
            rows: Vec::new(),
            script: Some(ScriptCall {
                ui,
                items: vec![t.item()],
            }),
            url: None,
        });
    }
    let rows = t
        .run(|r, ext, path| r.details(ext, path))
        .unwrap_or_else(|e| {
            log::warn!("ファイルの詳細を足せない: {}: {e}", t.path.display());
            Vec::new()
        });
    Ok(Details {
        size,
        rows: rows_of(rows),
        script: None,
        url: None,
    })
}

#[tauri::command]
pub(crate) async fn item_decoded(
    cur: State<'_, Current>,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let t = Target::of(&cur, &id)?;
    let keep = t
        .plugins
        .keeps_decoded(&t.ext)
        .and_then(|(plugin, format)| {
            let dir = thumb::decoded_dir(&t.thumbs, plugin, format);
            thumb::path_for(&dir, &t.id, &t.path, &Reads::new())
        });
    if let Some(png) = keep.as_ref().and_then(|p| std::fs::read(p).ok()) {
        return Ok(tauri::ipc::Response::new(png));
    }
    let png = t.run(|r, ext, path| r.decode(ext, path))?;
    if let Some(out) = keep {
        thumb::keep(&out, &png);
    }
    Ok(tauri::ipc::Response::new(png))
}

/// plugin が None のときは、本体（どの links にも当てはまらない URL の OGP など）が取りに行く。
#[tauri::command]
pub(crate) async fn plugin_fetch(
    cur: State<'_, Current>,
    plugin: Option<String>,
    url: String,
) -> Result<tauri::ipc::Response, String> {
    let url = web::parse(&url)?;
    let plugins = with_session(&cur, |s| Ok(Arc::clone(&s.plugins)))?;
    let allow = move |u: &tauri::Url| {
        plugins.may_fetch(plugin.as_deref(), u.host_str().unwrap_or_default())
    };
    allow(&url)?;
    let out = tauri::async_runtime::spawn_blocking(move || web::fetch(&url, allow))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
pub(crate) async fn wasm_details(
    cur: State<'_, Current>,
    id: String,
) -> Result<Vec<Detail>, String> {
    let t = Target::of(&cur, &id)?;
    Ok(rows_of(t.run(|r, ext, path| r.details(ext, path))?))
}

#[tauri::command]
pub(crate) async fn plugin_read(
    cur: State<'_, Current>,
    id: String,
    offset: u64,
    length: u32,
) -> Result<tauri::ipc::Response, String> {
    let path = with(&cur, |l| Ok(l.file(&id)?.0.to_owned()))?;
    Ok(tauri::ipc::Response::new(plugin::read(
        &path, offset, length,
    )?))
}

#[tauri::command]
pub(crate) async fn plugin_call(
    cur: State<'_, Current>,
    id: String,
    part: Part,
    plugin: Option<String>,
    method: String,
    args: String,
    owner: Option<String>,
) -> Result<String, String> {
    // 右クリックメニューは拡張子の担当と別に決まるので、受け持つプラグインを画面から受け取る
    let menu = (part == Part::Menu)
        .then(|| owner.ok_or("右クリックメニューのプラグインが指定されていません"))
        .transpose()?;
    let t = if menu.is_some() {
        Target::any(&cur, &id)?
    } else {
        Target::of(&cur, &id)?
    };
    let note = t.note;
    let (r, reads) = t.run(|r, ext, path| {
        r.reading(|r| {
            let owner = match menu.as_deref() {
                Some(plugin) => UiOwner::Menu { plugin, note },
                None => UiOwner::Format(part),
            };
            r.call_ui(ext, owner, path, plugin.as_deref(), &method, &args)
        })
    });
    // 呼んでいるあいだにライブラリを開き直していたら、読んだ設定は残さない
    if part == Part::Thumbnail
        && let Some(s) = cur.lock().as_mut()
        && Arc::ptr_eq(&s.plugins, &t.plugins)
    {
        s.ui_reads.entry(id).or_default().extend(reads);
    }
    r
}

/// ノートのコードブロックを WASM で描く。SVG は UTF-8 の文字、PNG はそのままで返し、画面は先頭のバイトで見分ける
/// （PNG の先頭の 0x89 は、UTF-8 の文字の先頭にならない）。
#[tauri::command]
pub(crate) async fn render_code(
    cur: State<'_, Current>,
    plugin: String,
    lang: String,
    source: String,
) -> Result<tauri::ipc::Response, String> {
    let (runner, plugins) = with_session(&cur, |s| {
        Ok((Arc::clone(&s.runner), Arc::clone(&s.plugins)))
    })?;
    let render = |r: &mut Runner| r.render_code(&plugin, &lang, &source);
    let out = match runner.try_lock() {
        Ok(mut r) => render(&mut r),
        Err(_) => render(&mut Runner::new(plugins)),
    }?;
    Ok(tauri::ipc::Response::new(match out {
        CodeOut::Svg(s) => s.into_bytes(),
        CodeOut::Png(b) => b,
    }))
}

#[tauri::command]
pub(crate) async fn plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
) -> Result<Option<String>, String> {
    with_session(&cur, |s| s.plugins.data_of(&plugin, &key))
}

#[tauri::command]
pub(crate) async fn set_plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    with_session(&cur, |s| s.plugins.set_data_of(&plugin, &key, value))
}

#[tauri::command]
pub(crate) async fn plugin_settings(
    cur: State<'_, Current>,
    plugin: String,
) -> Result<serde_json::Map<String, Value>, String> {
    with_session(&cur, |s| {
        s.plugins
            .settings_of(&plugin)
            .ok_or_else(|| format!("プラグイン「{plugin}」は有効ではありません"))
    })
}

pub(crate) fn plugin_file(
    app: &tauri::AppHandle,
    req: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let Some((id, rest)) = plugin::files::split(req.uri().path()) else {
        return plugin::files::serve("", None);
    };
    let cur = app.state::<Current>();
    let body = cur
        .0
        .lock()
        .ok()
        .and_then(|g| g.as_ref()?.plugins.file(&id, &rest));
    plugin::files::serve(&rest, body)
}
