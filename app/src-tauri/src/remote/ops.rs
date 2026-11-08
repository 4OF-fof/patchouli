//! 外から頼まれた操作。画面から操作したときと同じように、サムネイルとフックを用意し、画面に変わったものを知らせる。

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::{embed, search};
use crate::background;
use crate::library::ipc::{import_paths, recheck, relinked};
use crate::library::{Changes, ItemPatch, ListDiff, Place, StoredItem, shortcut};
use crate::plugin::{HookEvent, hooks};
use crate::session::{Current, with, with_session};
use crate::shell::{settings, tray, web};
use crate::thumb::ipc::{make_thumbs, plan_thumbs};

/// ライブラリを開き終えるのを待つ長さ。CLI がアプリを起動した直後は、まだ開いていない。
const OPEN_WAIT: Duration = Duration::from_secs(60);
const DOWNLOAD_LIMIT: u64 = 2 << 30;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

/// peer は頼んできた口。トーストの再試行を、その口に知らせる。
pub fn call(app: &AppHandle, peer: u64, method: &str, p: &Value) -> Result<Value, String> {
    match method {
        "app.show" => return show(app, p),
        "app.quit" => {
            tray::quit(app);
            return Ok(Value::Null);
        }
        "toast.show" => return toast(app, peer, p),
        _ => {}
    }
    wait_open(app)?;
    let cur = app.state::<Current>();
    match method {
        "library.info" => info(&cur),
        "items.list" => list(&cur, p),
        "items.get" => {
            let id = text(p, "id")?;
            let it = stored(&cur, &id)?;
            Ok(out(&it, &group_names(&cur)?))
        }
        "notes.read" => {
            let it = stored(&cur, &text(p, "id")?)?;
            if !it.note {
                return Err(format!("「{}」はノートではありません", it.name));
            }
            Ok(json!(it.body.unwrap_or_default()))
        }
        "tags.list" => tags(&cur),
        "projects.list" => projects(&cur),
        "search.content" => search_content(app, &cur, p),
        "items.import" => import(app, &cur, p),
        "items.importUrl" => import_url(app, &cur, p),
        "items.addLink" => add_link(app, &cur, p),
        "items.importData" => {
            let data = base64::engine::general_purpose::STANDARD
                .decode(text(p, "data")?.trim())
                .map_err(|e| format!("data を Base64 として読み込めませんでした：{e}"))?;
            import_bytes(app, &cur, p, &text(p, "name")?, &data, opt_text(p, "url"))
        }
        "notes.create" => create_note(app, &cur, p),
        "notes.write" => write_note(app, &cur, &text(p, "id")?, text(p, "body")?),
        "notes.append" => {
            let id = text(p, "id")?;
            let it = stored(&cur, &id)?;
            let body = it.body.unwrap_or_default();
            let add = text(p, "text")?;
            let sep = if body.is_empty() || body.ends_with('\n') {
                ""
            } else {
                "\n"
            };
            write_note(app, &cur, &id, format!("{body}{sep}{add}"))
        }
        "items.update" => update(app, &cur, p),
        "items.rename" => rename(app, &cur, p),
        "items.move" => {
            let id = text(p, "id")?;
            let before = stored(&cur, &id)?;
            let it = with(&cur, |l| l.move_item(&id, &place(p)))?;
            if (&before.project, &before.group) != (&it.project, &it.group) {
                hooks::queue(app, HookEvent::Edited, std::slice::from_ref(&id));
                changed(app, vec![it.clone()], vec![]);
            }
            Ok(out(&it, &group_names(&cur)?))
        }
        "projects.create" => {
            let p = with(&cur, |l| l.create_project(&text(p, "name")?))?;
            let projects = with(&cur, |l| l.cache().projects())?;
            emit(
                app,
                Changes {
                    projects: Some(projects),
                    ..Changes::default()
                },
            );
            Ok(json!({ "name": p.name }))
        }
        "projects.rename" => {
            with(&cur, |l| {
                l.rename_project(&text(p, "from")?, &text(p, "to")?)
            })?;
            recheck(app)?;
            Ok(Value::Null)
        }
        "projects.delete" => {
            let r = with(&cur, |l| l.delete_project(&text(p, "name")?));
            recheck(app)?;
            r.map(|()| Value::Null)
        }
        "groups.create" => {
            let g = with(&cur, |l| l.create_group(&text(p, "name")?, &place(p)))?;
            let groups = with(&cur, |l| l.cache().groups())?;
            emit(
                app,
                Changes {
                    groups: Some(groups),
                    ..Changes::default()
                },
            );
            Ok(json!({ "id": g.id, "name": g.name, "project": g.project, "parent": g.parent }))
        }
        "tags.rename" => rename_tag(app, &cur, p),
        "items.delete" => {
            let id = text(p, "id")?;
            with(&cur, |l| l.delete_item(&id))?;
            changed(app, vec![], vec![id]);
            Ok(Value::Null)
        }
        _ => Err(format!("操作「{method}」は存在しません")),
    }
}

fn wait_open(app: &AppHandle) -> Result<(), String> {
    let until = Instant::now() + OPEN_WAIT;
    while app.state::<Current>().lock().is_none() {
        if Instant::now() >= until {
            return Err("ライブラリが開かれていません".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}

fn show(app: &AppHandle, p: &Value) -> Result<Value, String> {
    tray::show_main(app);
    if let Some(id) = opt_text(p, "id") {
        wait_open(app)?;
        stored(&app.state::<Current>(), &id)?;
        app.emit_to(web::MAIN, "remote-open", &id)
            .map_err(|e| e.to_string())?;
    }
    Ok(Value::Null)
}

fn toast(app: &AppHandle, peer: u64, p: &Value) -> Result<Value, String> {
    text(p, "key")?;
    let state = text(p, "state")?;
    if !["saving", "saved", "failed"].contains(&state.as_str()) {
        return Err("state には saving・saved・failed のいずれかを指定してください".into());
    }
    let Value::Object(mut v) = p.clone() else {
        return Err("params を指定してください".into());
    };
    v.insert("peer".into(), json!(peer));
    app.emit_to(web::MAIN, "remote-toast", &v)
        .map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

fn opt_text(p: &Value, key: &str) -> Option<String> {
    p.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn text(p: &Value, key: &str) -> Result<String, String> {
    opt_text(p, key).ok_or_else(|| format!("「{key}」を指定してください"))
}

fn texts(p: &Value, key: &str) -> Vec<String> {
    match p.get(key) {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn number(p: &Value, key: &str) -> Option<usize> {
    p.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| usize::try_from(n).ok())
}

fn place(p: &Value) -> Place {
    Place {
        project: opt_text(p, "project").filter(|s| !s.is_empty()),
        group: opt_text(p, "group").filter(|s| !s.is_empty()),
    }
}

fn stored(cur: &State<Current>, id: &str) -> Result<StoredItem, String> {
    with(cur, |l| l.stored(id))?.ok_or_else(|| format!("ID「{id}」の項目が見つかりません"))
}

fn group_names(cur: &State<Current>) -> Result<HashMap<String, String>, String> {
    Ok(with(cur, |l| l.cache().groups())?
        .into_iter()
        .map(|g| (g.id, g.name))
        .collect())
}

fn out(it: &StoredItem, groups: &HashMap<String, String>) -> Value {
    let mut v = json!({
        "id": it.id,
        "name": it.name,
        "ext": it.ext,
        "type": if it.note { "note" } else { "asset" },
        "project": it.project,
        "group": it.group,
        "groupName": it.group.as_ref().and_then(|g| groups.get(g)),
        "tags": it.tags,
        "aliases": it.aliases.clone().unwrap_or_default(),
        "memo": it.memo,
        "url": it.url,
        "file": it.file,
        "mtime": it.mtime,
    });
    if let (Some(w), Some(h)) = (it.width, it.height) {
        v["width"] = json!(w);
        v["height"] = json!(h);
    }
    v
}

fn emit(app: &AppHandle, c: Changes) {
    if !c.is_empty()
        && let Err(e) = app.emit("library-changed", &c)
    {
        log::warn!("変わったものを画面に知らせられない: {e}");
    }
}

fn changed(app: &AppHandle, items: Vec<StoredItem>, removed: Vec<String>) {
    emit(
        app,
        Changes {
            items,
            removed,
            ..Changes::default()
        },
    );
}

fn info(cur: &State<Current>) -> Result<Value, String> {
    let s = with(cur, |l| l.snapshot())?;
    let notes = s.items.iter().filter(|i| i.note).count();
    let tags: HashSet<&String> = s.items.iter().flat_map(|i| &i.tags).collect();
    Ok(json!({
        "root": s.root,
        "name": s.root.file_name().map(|n| n.to_string_lossy()),
        "assets": s.items.len() - notes,
        "notes": notes,
        "projects": s.projects.len(),
        "groups": s.groups.len(),
        "tags": tags.len(),
    }))
}

fn has_tag(it: &StoredItem, tag: &str) -> bool {
    it.tags.iter().any(|t| {
        t == tag
            || t.strip_prefix(tag)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

fn list(cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let s = with(cur, |l| l.snapshot())?;
    let groups: HashMap<String, String> = s.groups.into_iter().map(|g| (g.id, g.name)).collect();
    let words: Vec<String> = opt_text(p, "query")
        .unwrap_or_default()
        .to_lowercase()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    let tags = texts(p, "tags");
    let exts: Vec<String> = texts(p, "exts")
        .into_iter()
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .collect();
    let project = opt_text(p, "project");
    let group = opt_text(p, "group");
    let kind = opt_text(p, "type");
    if let Some(k) = &kind
        && k != "note"
        && k != "asset"
    {
        return Err(format!(
            "type は note か asset を指定してください（指定：{k}）"
        ));
    }
    let mut hits: Vec<&StoredItem> = s
        .items
        .iter()
        .filter(|it| {
            if kind.as_deref().is_some_and(|k| (k == "note") != it.note) {
                return false;
            }
            if !exts.is_empty() && !exts.contains(&it.ext) {
                return false;
            }
            if let Some(pr) = &project
                && it.project.as_deref().unwrap_or("") != pr
            {
                return false;
            }
            if group.is_some() && it.group != group {
                return false;
            }
            if !tags.iter().all(|t| has_tag(it, t)) {
                return false;
            }
            if words.is_empty() {
                return true;
            }
            let hay = [
                it.name.as_str(),
                it.memo.as_str(),
                it.body.as_deref().unwrap_or(""),
            ]
            .into_iter()
            .chain(it.aliases.iter().flatten().map(String::as_str))
            .collect::<Vec<_>>()
            .join("\n")
            .to_lowercase();
            words.iter().all(|w| hay.contains(w))
        })
        .collect();
    hits.sort_by(|a, b| b.mtime.total_cmp(&a.mtime));
    let total = hits.len();
    let offset = number(p, "offset").unwrap_or(0);
    let limit = number(p, "limit").unwrap_or(50);
    let items: Vec<Value> = hits
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|it| out(it, &groups))
        .collect();
    Ok(json!({ "total": total, "items": items }))
}

fn tags(cur: &State<Current>) -> Result<Value, String> {
    let s = with(cur, |l| l.snapshot())?;
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for t in s.items.iter().flat_map(|i| &i.tags) {
        *counts.entry(t).or_default() += 1;
    }
    let mut list: Vec<(&str, usize)> = counts.into_iter().collect();
    list.sort_by(|a, b| a.0.cmp(b.0));
    Ok(json!(
        list.into_iter()
            .map(|(tag, count)| json!({ "tag": tag, "count": count }))
            .collect::<Vec<_>>()
    ))
}

fn projects(cur: &State<Current>) -> Result<Value, String> {
    let s = with(cur, |l| l.snapshot())?;
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for p in s.items.iter().filter_map(|i| i.project.as_deref()) {
        *counts.entry(p).or_default() += 1;
    }
    let projects: Vec<Value> = s
        .projects
        .iter()
        .map(|p| json!({ "name": p.name, "count": counts.get(p.name.as_str()).copied().unwrap_or(0) }))
        .collect();
    let groups: Vec<Value> = s
        .groups
        .iter()
        .map(|g| {
            json!({
                "id": g.id,
                "name": g.name,
                "project": g.project,
                "parent": g.parent,
                "type": g.kind,
            })
        })
        .collect();
    Ok(json!({ "projects": projects, "groups": groups }))
}

fn search_content(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    if !settings::auto_tag(app)? {
        return Err("AI 機能が無効になっています".into());
    }
    if !settings::content_search(app)? {
        return Err("AI 検索が無効になっています".into());
    }
    let query = text(p, "query")?;
    embed::warm()?;
    let thumbs = with_session(cur, |s| Ok(s.thumbs.clone()))?;
    let hits = serde_json::to_value(search::search(&thumbs, &query)?).map_err(|e| e.to_string())?;
    let s = with(cur, |l| l.snapshot())?;
    let groups: HashMap<String, String> = s.groups.into_iter().map(|g| (g.id, g.name)).collect();
    let items: HashMap<&str, &StoredItem> = s.items.iter().map(|i| (i.id.as_str(), i)).collect();
    let limit = number(p, "limit").unwrap_or(20);
    let found: Vec<Value> = hits
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|h| {
            let it = items.get(h.get("id")?.as_str()?)?;
            let mut v = out(it, &groups);
            v["score"] = h["score"].clone();
            if let Some(at) = h.get("at") {
                v["at"] = at.clone();
            }
            Some(v)
        })
        .take(limit)
        .collect();
    Ok(json!(found))
}

/// 取り込んだものにタグと URL を付け、サムネイルとフックを用意して画面に知らせる。
fn added(
    app: &AppHandle,
    cur: &State<Current>,
    items: Vec<StoredItem>,
    tags: &[String],
    url: Option<String>,
) -> Result<Vec<StoredItem>, String> {
    let url = url.filter(|u| !u.trim().is_empty());
    let mut items = if tags.is_empty() && url.is_none() {
        items
    } else {
        let patch = ItemPatch {
            tags: (!tags.is_empty()).then(|| ListDiff {
                add: tags.to_vec(),
                remove: vec![],
            }),
            url,
            ..ItemPatch::default()
        };
        with(cur, |l| {
            items
                .into_iter()
                .map(|it| {
                    l.save_item(&it.id, &patch)?;
                    Ok(l.stored(&it.id)?.unwrap_or(it))
                })
                .collect()
        })?
    };
    let (thumbs, plugins, cache) = with_session(cur, |s| {
        Ok((s.thumbs.clone(), Arc::clone(&s.plugins), s.lib.cache()))
    })?;
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut items);
    hooks::queue_items(app, HookEvent::Added, &items);
    if !jobs.is_empty() {
        let app = app.clone();
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    changed(app, items.clone(), vec![]);
    Ok(items)
}

fn outs(cur: &State<Current>, items: &[StoredItem]) -> Result<Value, String> {
    let groups = group_names(cur)?;
    Ok(json!(
        items.iter().map(|it| out(it, &groups)).collect::<Vec<_>>()
    ))
}

fn import(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let paths: Vec<PathBuf> = texts(p, "paths").into_iter().map(PathBuf::from).collect();
    if paths.is_empty() {
        return Err("取り込むファイルかフォルダのパスを指定してください".into());
    }
    let mv = match p.get("move").and_then(Value::as_bool) {
        Some(m) => m,
        None => settings::app_settings(app)?.import_mode == settings::ImportMode::Move,
    };
    let r = import_paths(cur, &paths, &place(p), mv)?;
    if !r.groups.is_empty() {
        let groups = with(cur, |l| l.cache().groups())?;
        emit(
            app,
            Changes {
                groups: Some(groups),
                ..Changes::default()
            },
        );
    }
    let items = added(app, cur, r.items, &texts(p, "tags"), opt_text(p, "url"))?;
    Ok(json!({
        "items": outs(cur, &items)?,
        "groups": r.groups.iter().map(|g| json!({ "id": g.id, "name": g.name })).collect::<Vec<_>>(),
        "skipped": r.skipped,
        "failed": r.failed,
    }))
}

fn import_bytes(
    app: &AppHandle,
    cur: &State<Current>,
    p: &Value,
    name: &str,
    bytes: &[u8],
    url: Option<String>,
) -> Result<Value, String> {
    let it = with(cur, |l| l.import_data(name, bytes, &place(p)))?;
    let items = added(app, cur, vec![it], &texts(p, "tags"), url)?;
    let groups = group_names(cur)?;
    items
        .first()
        .map(|it| out(it, &groups))
        .ok_or_else(|| "取り込みに失敗しました".into())
}

/// Windows でファイル名に使えない文字を「_」にする。
fn file_safe(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"\/:*?"<>|"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let s = s
        .trim()
        .trim_start_matches('.')
        .trim_end_matches(['.', ' ']);
    s.chars().take(120).collect()
}

fn ext_of_type(kind: &str) -> Option<&'static str> {
    let kind = kind.split(';').next()?.trim().to_ascii_lowercase();
    Some(match kind.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        _ => return None,
    })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && let Some(v) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn import_url(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let url = web::parse(&text(p, "url")?)?;
    let referer = opt_text(p, "referer").filter(|r| !r.is_empty());
    let cookie = opt_text(p, "cookie").filter(|c| !c.is_empty());
    let sent = web::Sent {
        referer: referer.as_deref(),
        cookie: cookie.as_deref(),
    };
    let (head, body) = web::get_within(&url, |_| Ok(()), &sent, DOWNLOAD_LIMIT, DOWNLOAD_TIMEOUT)?;
    if !(200..300).contains(&head.status) {
        return Err(format!("{url}: 取得に失敗しました（{}）", head.status));
    }
    let from_url = || {
        tauri::Url::parse(&head.url)
            .ok()
            .and_then(|u| {
                u.path_segments()
                    .and_then(|mut s| s.next_back().map(percent_decode))
            })
            .filter(|n| !n.is_empty())
    };
    let base = file_safe(
        &opt_text(p, "name")
            .or_else(from_url)
            .unwrap_or_else(|| "download".into()),
    );
    let has_ext = std::path::Path::new(&base)
        .extension()
        .is_some_and(|e| !e.is_empty());
    let name = match head.kind.as_deref().and_then(ext_of_type) {
        Some(ext) if !has_ext => format!("{base}.{ext}"),
        _ => base,
    };
    import_bytes(app, cur, p, &name, &body, Some(url.to_string()))
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

fn page_title(url: &tauri::Url) -> Option<String> {
    let (head, body) = web::get(url, |_| Ok(())).ok()?;
    if !(200..300).contains(&head.status) {
        return None;
    }
    let html = String::from_utf8_lossy(&body);
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open = start + lower[start..].find('>')? + 1;
    let close = open + lower[open..].find("</title")?;
    let t = decode_entities(html[open..close].trim());
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    (!t.is_empty()).then_some(t)
}

fn add_link(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let url = web::parse(&text(p, "url")?)?;
    let name = opt_text(p, "name")
        .or_else(|| page_title(&url))
        .unwrap_or_else(|| url.host_str().unwrap_or("link").to_owned());
    let name = file_safe(&name);
    let body = shortcut::content(url.as_str());
    import_bytes(
        app,
        cur,
        p,
        &format!("{name}.{}", shortcut::EXT),
        body.as_bytes(),
        None,
    )
}

fn create_note(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let it = with(cur, |l| l.create_note(&text(p, "name")?, &place(p)))?;
    let it = match opt_text(p, "body") {
        Some(body) => with(cur, |l| {
            l.save_item(
                &it.id,
                &ItemPatch {
                    body: Some(body),
                    ..ItemPatch::default()
                },
            )?;
            Ok(l.stored(&it.id)?.unwrap_or(it))
        })?,
        None => it,
    };
    let items = added(app, cur, vec![it], &texts(p, "tags"), opt_text(p, "url"))?;
    let groups = group_names(cur)?;
    items
        .first()
        .map(|it| out(it, &groups))
        .ok_or_else(|| "ノートの作成に失敗しました".into())
}

fn write_note(
    app: &AppHandle,
    cur: &State<Current>,
    id: &str,
    body: String,
) -> Result<Value, String> {
    let it = stored(cur, id)?;
    if !it.note {
        return Err(format!("「{}」はノートではありません", it.name));
    }
    let patch = ItemPatch {
        body: Some(body),
        ..ItemPatch::default()
    };
    let (conflict, it) = with(cur, |l| {
        let conflict = l.save_item(id, &patch)?;
        Ok((conflict, l.stored(id)?))
    })?;
    let it = it.ok_or_else(|| format!("ID「{id}」の項目が見つかりません"))?;
    changed(app, vec![it.clone()], vec![]);
    if conflict.is_some() {
        return Err(format!(
            "「{}」がアプリの外で変更されていたため、書き換えずに読み込み直しました",
            it.name
        ));
    }
    hooks::queue(app, HookEvent::Changed, &[id.to_owned()]);
    Ok(out(&it, &group_names(cur)?))
}

fn diff(p: &Value, add: &str, remove: &str) -> Option<ListDiff> {
    let (add, remove) = (texts(p, add), texts(p, remove));
    (!add.is_empty() || !remove.is_empty()).then_some(ListDiff { add, remove })
}

fn update(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let id = text(p, "id")?;
    let patch = ItemPatch {
        tags: diff(p, "addTags", "removeTags"),
        aliases: diff(p, "addAliases", "removeAliases"),
        memo: opt_text(p, "memo"),
        url: opt_text(p, "url"),
        body: None,
    };
    let retag = patch.tags.is_some();
    let (conflict, it) = with(cur, |l| {
        let conflict = l.save_item(&id, &patch)?;
        Ok((conflict, l.stored(&id)?))
    })?;
    let it = it.ok_or_else(|| format!("ID「{id}」の項目が見つかりません"))?;
    changed(app, vec![it.clone()], vec![]);
    if retag {
        hooks::queue(app, HookEvent::Edited, std::slice::from_ref(&id));
    }
    if patch.url.is_some() {
        relinked(app, cur, &id)?;
    }
    if conflict.is_some() && (patch.memo.is_some() || patch.url.is_some()) {
        return Err(format!(
            "「{}」がアプリの外で変更されていたため、書き換えずに読み込み直しました",
            it.name
        ));
    }
    Ok(out(&it, &group_names(cur)?))
}

fn rename(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let id = text(p, "id")?;
    let name = text(p, "name")?;
    let (it, old, mut renamed) = with(cur, |l| {
        let old = l.stored(&id)?.map(|it| it.name).unwrap_or_default();
        let it = l.rename_item(&id, &name)?;
        let renamed = l.sync_link_names(&HashMap::from([(id.clone(), old.clone())]));
        Ok((it, old, renamed))
    })?;
    if old != it.name {
        hooks::queue(app, HookEvent::Edited, std::slice::from_ref(&id));
    }
    renamed.retain(|x| x.id != it.id);
    renamed.push(it.clone());
    changed(app, renamed, vec![]);
    Ok(out(&it, &group_names(cur)?))
}

fn rename_tag(app: &AppHandle, cur: &State<Current>, p: &Value) -> Result<Value, String> {
    let (from, to) = (text(p, "from")?, text(p, "to")?);
    if to.trim().is_empty() {
        return Err("新しい名前を指定してください".into());
    }
    let ids: Vec<String> = with(cur, |l| l.snapshot())?
        .items
        .into_iter()
        .filter(|it| has_tag(it, &from))
        .map(|it| it.id)
        .collect();
    let r = with(cur, |l| l.rename_tag(&from, &to, false));
    let (items, covers) = with(cur, |l| {
        let items: Vec<StoredItem> = ids
            .iter()
            .filter_map(|id| l.stored(id).ok().flatten())
            .collect();
        Ok((items, l.cache().tag_covers()?))
    })?;
    hooks::queue(app, HookEvent::Edited, &ids);
    emit(
        app,
        Changes {
            items,
            tag_covers: Some(covers),
            ..Changes::default()
        },
    );
    r.map(|()| json!({ "items": ids.len() }))
}
