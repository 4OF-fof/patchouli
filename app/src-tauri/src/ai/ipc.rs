use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::ai::{content, decisions, embed, search, suggest};
use crate::session::{Current, root_of, with_session};
use crate::shell::settings;

#[tauri::command]
pub(crate) async fn content_wasm(job: u64) -> Result<Vec<content::WasmPart>, String> {
    tauri::async_runtime::spawn_blocking(move || content::wasm(job))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn put_content(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => &[],
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let job = head("job")
        .and_then(|v| v.parse().ok())
        .ok_or("job が指定されていません")?;
    let error: Option<String> = head("error").and_then(|v| serde_json::from_str(v).ok());
    let ms = head("ms").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let body = body.to_vec();
    tauri::async_runtime::spawn_blocking(move || content::put(job, &body, error.as_deref(), ms))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoTag {
    enabled: bool,
    installed: bool,
    downloading: bool,
    /// これからダウンロードする大きさ
    need: u64,
    /// llama-server が使える GPU。空なら CPU で動かす。入れる前は None
    gpus: Option<Vec<String>>,
    suggest: settings::TagSuggest,
    search: bool,
}

#[tauri::command]
pub(crate) async fn auto_tag(app: tauri::AppHandle) -> Result<AutoTag, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let installed = embed::installed();
        let gpus = installed
            .then(embed::gpus)
            .transpose()
            .inspect_err(|e| log::warn!("GPU を調べられない: {e}"))
            .ok()
            .flatten();
        Ok(AutoTag {
            enabled: settings::auto_tag(&app)?,
            installed,
            downloading: embed::install::downloading(),
            need: embed::install::need(),
            gpus,
            suggest: settings::tag_suggest(&app)?,
            search: settings::content_search(&app)?,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct DownloadProgress<'a> {
    file: &'a str,
    done: u64,
    total: u64,
}

/// 有効にするときは、なければ llama.cpp とモデルをダウンロードし終えてから、いまのライブラリのベクトルを作り始める。
#[tauri::command]
pub(crate) async fn set_auto_tag(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !on {
            settings::set_auto_tag(&app, false)?;
            content::stop(&app);
            embed::shutdown();
            return Ok(());
        }
        if !embed::installed() {
            embed::install::install(&mut |p| {
                let _ = app.emit(
                    "auto-tag-progress",
                    DownloadProgress {
                        file: p.file,
                        done: p.done,
                        total: p.total,
                    },
                );
            })?;
        }
        settings::set_auto_tag(&app, true)?;
        let cur = app.state::<Current>();
        let open = with_session(&cur, |s| {
            Ok((
                Arc::clone(&s.plugins),
                s.lib.snapshot()?.items,
                s.thumbs.clone(),
            ))
        });
        if let Ok((plugins, items, thumbs)) = open {
            content::collect(&app, &plugins, &items, &thumbs);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_auto_tag_download() {
    embed::install::cancel();
}

#[tauri::command]
pub(crate) async fn set_tag_suggest(
    app: tauri::AppHandle,
    mode: settings::TagSuggest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        settings::set_tag_suggest(&app, mode)?;
        refresh_suggestions(&app, false);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn set_content_search(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    settings::set_content_search(&app, on)
}

/// 内容での検索に入ったときに呼ぶ。llama-server が起動し終えるまで待つ。
#[tauri::command]
pub(crate) async fn prepare_content_search(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !settings::auto_tag(&app)? {
            return Err("AI 機能が無効になっています".into());
        }
        if !settings::content_search(&app)? {
            return Err("AI 検索が無効になっています".into());
        }
        embed::warm()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn search_content(
    cur: State<'_, Current>,
    query: String,
) -> Result<Vec<search::Hit>, String> {
    let thumbs = with_session(&cur, |s| Ok(s.thumbs.clone()))?;
    tauri::async_runtime::spawn_blocking(move || search::search(&thumbs, &query))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct Suggestions {
    /// 画面で、選択済みの候補をそのまま付ける
    apply: bool,
    items: HashMap<String, suggest::Suggestion>,
}

/// いまのライブラリのタグ候補を作り直し、できたら画面に渡す。
/// all でなければ、前に作ったときから変わった項目だけを読み直す。
pub(crate) fn refresh_suggestions(app: &tauri::AppHandle, all: bool) {
    if !settings::auto_tag(app).unwrap_or(false) || !embed::installed() {
        return;
    }
    let off = |app: &tauri::AppHandle| {
        let _ = app.emit(
            "suggestions-changed",
            Suggestions {
                apply: false,
                items: HashMap::new(),
            },
        );
    };
    if settings::tag_suggest(app).unwrap_or_default() == settings::TagSuggest::Off {
        off(app);
        return;
    }
    let cur = app.state::<Current>();
    let Ok((root, thumbs, generation, source)) = with_session(&cur, |s| {
        let cache = s.lib.cache();
        let generation = cache.generation();
        let changed = suggest::built(s.lib.root())
            .filter(|_| !all)
            .and_then(|g| cache.changed_since(g));
        let source = match changed {
            Some(ids) => {
                let (mut items, mut removed) = (Vec::new(), Vec::new());
                for id in ids {
                    match s.lib.stored(&id)? {
                        Some(it) => items.push(it),
                        None => removed.push(id),
                    }
                }
                suggest::Source::Changed { items, removed }
            }
            None => suggest::Source::All(s.lib.snapshot()?.items),
        };
        Ok((
            s.lib.root().to_owned(),
            s.thumbs.clone(),
            generation,
            source,
        ))
    }) else {
        return;
    };
    let app = app.clone();
    // 作っている間に設定が変わることがあるので、渡すときに読み直す
    suggest::refresh(
        &root,
        &thumbs,
        source,
        generation,
        move |s| match settings::tag_suggest(&app).unwrap_or_default() {
            settings::TagSuggest::Off => off(&app),
            mode => {
                let _ = app.emit(
                    "suggestions-changed",
                    Suggestions {
                        apply: mode == settings::TagSuggest::Auto,
                        items: s,
                    },
                );
            }
        },
    );
}

/// 分類の確認で承認した item の判断を残す。chosen は付けたタグ、rejected は外した候補。
#[tauri::command]
pub(crate) async fn record_tags(
    app: tauri::AppHandle,
    item: String,
    chosen: Vec<String>,
    rejected: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        decisions::record(
            &root_of(&app.state::<Current>())?,
            &settings::device(&app)?,
            &item,
            &chosen,
            &rejected,
        )?;
        refresh_suggestions(&app, false);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn undo_tags(app: tauri::AppHandle, item: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        decisions::undo(
            &root_of(&app.state::<Current>())?,
            &settings::device(&app)?,
            &item,
        )?;
        refresh_suggestions(&app, false);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn suggest_tags(id: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || suggest::suggest_tags(&id))
        .await
        .map_err(|e| e.to_string())
}
