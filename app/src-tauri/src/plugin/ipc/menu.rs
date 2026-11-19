use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::background;
use crate::library::{self, ItemPatch, Library, ListDiff, Place, StoredItem};
use crate::plugin::{
    Action, HookEvent, ItemInfo, MenuRun, MenuShown, Ran, Runner, TargetFile, hooks,
};

use crate::library::ipc::import_paths;
use crate::plugin::ipc::call::{Detail, rows_of};
use crate::plugin::ipc::{Target, env_of, info_of, targets};
use crate::session::{Current, with, with_session};
use crate::thumb::ipc::{make_thumbs, plan_thumbs};

/// 選んだものをまとめて plugin のメニューに渡す。
fn run_menu_of<T>(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    ts: &[Target],
    f: impl FnOnce(&mut Runner, &[TargetFile]) -> Result<T, String>,
) -> Result<T, String> {
    let first = ts.first().ok_or("項目が選択されていません")?;
    let infos: Vec<Option<ItemInfo>> = with(cur, |l| {
        ts.iter()
            .map(|t| Ok(l.stored(&t.id)?.map(info_of)))
            .collect()
    })?;
    let files: Vec<TargetFile> = ts
        .iter()
        .zip(infos)
        .map(|(t, info)| TargetFile {
            ext: &t.ext,
            note: t.note,
            path: &t.path,
            info,
        })
        .collect();
    let env = env_of(app, &first.thumbs);
    first.runner(|r| {
        r.set_env(Some(env));
        let out = f(r, &files);
        r.set_env(None);
        out
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MenuOutput {
    Overlay {
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        rows: Vec<Detail>,
    },
    Screen {
        id: String,
    },
    /// SDK の MenuOutput に合わせて、{ toast, level } で送る。
    #[serde(untagged)]
    Toast {
        toast: String,
        level: &'static str,
    },
}

/// run-menu の結果。copy は写すもの、items は作ったノートと登録した素材、saved は書き出した先、
/// failed は起こせなかったこと。書き換えたものは library-changed で知らせる。
#[derive(Serialize)]
pub(crate) struct MenuDone {
    output: Option<MenuOutput>,
    copy: Option<String>,
    items: Vec<StoredItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    saved: Option<PathBuf>,
    failed: Vec<String>,
}

fn finish_menu(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    ts: &[Target],
    run: MenuRun,
) -> Result<MenuDone, String> {
    let output = match run.shown {
        MenuShown::None => None,
        MenuShown::Toast { text, level } => Some(MenuOutput::Toast { toast: text, level }),
        MenuShown::Overlay { title, rows } => Some(MenuOutput::Overlay {
            title,
            rows: rows_of(rows),
        }),
        MenuShown::Screen(id) => Some(MenuOutput::Screen { id }),
    };
    let ids: Vec<String> = ts.iter().map(|t| t.id.clone()).collect();
    let a = apply_ran(app, cur, &ids, run.ran)?;
    hooks::queue_items(app, HookEvent::Added, &a.added);
    hooks::queue(app, HookEvent::Changed, &a.changed);
    hooks::queue(app, HookEvent::Edited, &a.edited);
    Ok(MenuDone {
        output,
        copy: a.copy,
        items: a.added,
        saved: a.saved,
        failed: a.failed,
    })
}

/// 頼まれたことを起こした結果。changed は中身を、edited は名前やタグを書き換えたものの ID。
#[derive(Default)]
pub(crate) struct Applied {
    pub(crate) copy: Option<String>,
    pub(crate) added: Vec<StoredItem>,
    pub(crate) changed: Vec<String>,
    pub(crate) edited: Vec<String>,
    pub(crate) saved: Option<PathBuf>,
    pub(crate) failed: Vec<String>,
}

/// run-menu・hook で頼まれたことを起こす。作るものの置き場は ids の先頭と同じにする。
/// 書き換えたものは library-changed で画面に知らせる。
pub(crate) fn apply_ran(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    ids: &[String],
    ran: Ran,
) -> Result<Applied, String> {
    let Ran { actions, scratch } = ran;
    let mut out = Applied::default();
    let mut notes = Vec::new();
    let mut assets = Vec::new();
    let mut edits = Vec::new();
    for a in actions {
        match a {
            Action::Copy(t) => out.copy = Some(t),
            Action::Note { name, body } => notes.push((name, body)),
            Action::Asset { path, name } => assets.push(named(path, name, &mut out.failed)),
            Action::Export { path, name } => match export_file(app, &path, &name) {
                Ok(to) => out.saved = to,
                Err(e) => out.failed.push(e),
            },
            a => edits.push(a),
        }
    }
    if notes.is_empty() && assets.is_empty() && edits.is_empty() {
        return Ok(out);
    }
    let first = ids.first().map(String::as_str);
    let mut changed: Vec<StoredItem> = Vec::new();
    let place = with_session(cur, |s| {
        let place = first
            .map(|id| s.lib.stored(id))
            .transpose()?
            .flatten()
            .map(|it| Place {
                project: it.project,
                group: it.group,
            })
            .unwrap_or_default();
        for (name, body) in notes {
            match note_with(&mut s.lib, &name, body, &place) {
                Ok(it) => out.added.push(it),
                Err(e) => out.failed.push(e),
            }
        }
        Ok(place)
    })?;
    if !assets.is_empty() {
        let r = import_paths(cur, &assets, &place, true)?;
        out.added.extend(r.items);
        out.failed.extend(r.failed);
    }
    let (thumbs, plugins, cache) = with_session(cur, |s| {
        let mut renamed: HashMap<String, String> = HashMap::new();
        let mut edited: Vec<String> = Vec::new();
        for a in edits {
            if let Action::Rename { target, .. } = &a
                && let Some(id) = ids.get(*target)
                && let Some(it) = s.lib.stored(id)?
            {
                renamed.entry(id.clone()).or_insert(it.name);
            }
            let content = matches!(a, Action::Body { .. } | Action::Replace { .. });
            match edit_item(&mut s.lib, ids, a) {
                Ok(id) => {
                    let by = if content {
                        &mut out.changed
                    } else {
                        &mut out.edited
                    };
                    if !by.contains(&id) {
                        by.push(id.clone());
                    }
                    if !edited.contains(&id) {
                        edited.push(id);
                    }
                }
                Err(e) => out.failed.push(e),
            }
        }
        // 書き換えは済んでいるので、読めなかったものは次に確かめたときに知らせる
        changed.extend(
            edited
                .iter()
                .filter_map(|id| s.lib.stored(id).ok().flatten()),
        );
        for it in s.lib.sync_link_names(&renamed) {
            changed.retain(|x| x.id != it.id);
            changed.push(it);
        }
        Ok((s.thumbs.clone(), Arc::clone(&s.plugins), s.lib.cache()))
    })?;
    drop(scratch);
    let (jobs, _, _) = plan_thumbs(
        &plugins,
        &thumbs,
        &cache,
        out.added.iter_mut().chain(changed.iter_mut()),
    );
    if !jobs.is_empty() {
        let app = app.clone();
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    if !changed.is_empty() {
        let changes = library::Changes {
            items: changed,
            ..library::Changes::default()
        };
        let _ = app.emit("library-changed", &changes);
    }
    Ok(out)
}

/// ids の target 番目を書き換える。書き換えたものの ID を返す。
fn edit_item(lib: &mut Library, ids: &[String], a: Action) -> Result<String, String> {
    let id_of = |t: usize| {
        ids.get(t)
            .cloned()
            .ok_or_else(|| "対象の項目が見つかりません".to_owned())
    };
    match a {
        Action::Body { target, body } => {
            let id = id_of(target)?;
            let patch = ItemPatch {
                body: Some(body),
                ..ItemPatch::default()
            };
            lib.save_item(&id, &patch)?;
            Ok(id)
        }
        Action::Rename { target, name } => {
            let id = id_of(target)?;
            lib.rename_item(&id, &name)?;
            Ok(id)
        }
        Action::Tags { target, tags } => {
            let id = id_of(target)?;
            let old = lib.stored(&id)?.map(|it| it.tags).unwrap_or_default();
            let patch = ItemPatch {
                tags: Some(ListDiff {
                    add: tags.iter().filter(|t| !old.contains(t)).cloned().collect(),
                    remove: old.iter().filter(|t| !tags.contains(t)).cloned().collect(),
                }),
                ..ItemPatch::default()
            };
            lib.save_item(&id, &patch)?;
            Ok(id)
        }
        Action::Replace { target, path } => {
            let id = id_of(target)?;
            lib.replace_file(&id, &path)?;
            Ok(id)
        }
        Action::Copy(_) | Action::Note { .. } | Action::Asset { .. } | Action::Export { .. } => {
            Err("書き換えではありません".into())
        }
    }
}

/// export で用意したファイルを、聞いた保存先へ写す。やめたときは None。
fn export_file(app: &tauri::AppHandle, from: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let Some(to) = save_dialog(app, name) else {
        return Ok(None);
    };
    std::fs::copy(from, &to)
        .map_err(|e| format!("「{}」への書き出しに失敗しました：{e}", to.display()))?;
    Ok(Some(to))
}

/// 書き出す先を聞く。name は既定の名前。
fn save_dialog(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("書き出し先を選択")
        .set_file_name(name);
    if let Some(ext) = Path::new(name).extension().and_then(|x| x.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    dialog.blocking_save_file()?.into_path().ok()
}

// 登録する名前にする。作業用の置き場の中で名前を変える。
pub(crate) fn named(path: PathBuf, name: Option<String>, failed: &mut Vec<String>) -> PathBuf {
    let Some(name) = name else { return path };
    let to = match path.extension() {
        Some(ext) => path.with_file_name(format!("{name}.{}", ext.to_string_lossy())),
        None => path.with_file_name(&name),
    };
    if to == path || to.exists() {
        return path;
    }
    match std::fs::rename(&path, &to) {
        Ok(()) => to,
        Err(e) => {
            failed.push(format!("「{name}」への名前の変更に失敗しました：{e}"));
            path
        }
    }
}

fn note_with(
    lib: &mut Library,
    name: &str,
    body: String,
    place: &Place,
) -> Result<StoredItem, String> {
    let mut it = lib.create_note(name, place)?;
    let patch = ItemPatch {
        body: Some(body.clone()),
        ..ItemPatch::default()
    };
    lib.save_item(&it.id, &patch)?;
    it.body = Some(body);
    Ok(it)
}

/// 右クリックメニューに項目を足すプラグイン。
fn menu_plugins(ts: &[Target]) -> Vec<String> {
    let Some(first) = ts.first() else {
        return Vec::new();
    };
    let keys: Vec<_> = ts.iter().map(|t| (t.ext.as_str(), t.note)).collect();
    first.plugins.menus(&keys)
}

/// 本文の中身を、聞いた保存先へ書く。やめたときは None。
#[tauri::command]
pub(crate) async fn export_data(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<PathBuf>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("リクエスト本文がファイルの中身ではありません".into());
    };
    let name: String = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .map(serde_json::from_str)
        .ok_or("ファイル名が指定されていません")?
        .map_err(|e| format!("name の読み込みに失敗しました：{e}"))?;
    library::check_name(&name)?;
    let Some(to) = save_dialog(&app, &name) else {
        return Ok(None);
    };
    std::fs::write(&to, bytes)
        .map_err(|e| format!("「{}」への書き出しに失敗しました：{e}", to.display()))?;
    Ok(Some(to))
}

#[derive(Serialize)]
pub(crate) struct MenuEntry {
    id: String,
    label: String,
}

fn entries_of(items: Vec<(String, String)>) -> Vec<MenuEntry> {
    items
        .into_iter()
        .map(|(id, label)| MenuEntry { id, label })
        .collect()
}

/// プラグイン 1 つが右クリックメニューに足すもの。
#[derive(Serialize)]
pub(crate) struct MenuGroup {
    plugin: String,
    items: Vec<MenuEntry>,
}

/// 項目を作れなかったプラグインは、ほかのプラグインの項目を出せるよう、記録して飛ばす。
#[tauri::command]
pub(crate) async fn item_menu(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    ids: Vec<String>,
) -> Result<Vec<MenuGroup>, String> {
    let ts = targets(&cur, &ids)?;
    let mut out = Vec::new();
    for plugin in menu_plugins(&ts) {
        match run_menu_of(&app, &cur, &ts, |r, files| r.menu(&plugin, files)) {
            Ok(items) if items.is_empty() => {}
            Ok(items) => out.push(MenuGroup {
                plugin,
                items: entries_of(items),
            }),
            Err(e) => log::warn!("右クリックメニューの項目を作れない（{plugin}）: {e}"),
        }
    }
    Ok(out)
}

#[tauri::command]
pub(crate) async fn run_item_menu(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    ids: Vec<String>,
    plugin: String,
    entry: String,
) -> Result<MenuDone, String> {
    let ts = targets(&cur, &ids)?;
    if !menu_plugins(&ts).contains(&plugin) {
        return Err("メニューに対応するプラグインがありません".into());
    }
    let run = run_menu_of(&app, &cur, &ts, |r, files| {
        r.run_menu(&plugin, files, &entry)
    })?;
    finish_menu(&app, &cur, &ts, run)
}
