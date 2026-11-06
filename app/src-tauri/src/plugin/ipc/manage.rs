use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::background;
use crate::library::{self, StoredItem};
use crate::plugin::record::{self, Source};
use crate::plugin::{self, By, Part, Registry, Runner, hooks, install};
use crate::thumb;

use crate::plugin::ipc::{dev_places, make_plugin_dir, plugin_dir, remove_plugins};
use crate::session::{Current, root_of, with_session};
use crate::shell::ipc::unused_plugins_of;
use crate::thumb::ipc::{make_thumbs, plan_thumbs, reads_now, spawn_thumbs, tell_thumb};

#[tauri::command]
pub(crate) async fn reload_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    wait: bool,
) -> Result<library::Opened, String> {
    let (root, old) = with_session(&cur, |s| {
        Ok((s.lib.root().to_owned(), Arc::clone(&s.plugins)))
    })?;
    if !wait {
        old.stop();
    }
    while thumb::pending() > 0 {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    old.stop();
    let (plugins, problems) =
        Registry::open(&root, &plugin_dir(&app, &root)?, dev_places(&app).as_ref());
    let plugins = Arc::new(plugins);
    let since = std::time::SystemTime::now();
    let (mut opened, thumbs, cache) = with_session(&cur, |s| {
        s.lib.set_plugins(Arc::clone(&plugins));
        let opened = s.lib.snapshot()?;
        s.plugins = Arc::clone(&plugins);
        s.runner = Arc::new(Mutex::new(Runner::new(Arc::clone(&plugins))));
        s.ui_reads.clear();
        Ok((opened, s.thumbs.clone(), s.lib.cache()))
    })?;
    let job = plan_thumbs(&plugins, &thumbs, &cache, &mut opened.items);
    let all_found = job.2;
    spawn_thumbs(&app, &plugins, &cache, &thumbs, job, all_found, since);
    opened.problems.extend(problems);
    Ok(opened)
}

#[tauri::command]
pub(crate) fn plugin_work() -> Vec<String> {
    thumb::pending_items()
}

#[tauri::command]
pub(crate) fn stop_plugin_work() {
    thumb::stop();
}

/// フックを待っているものと、いま渡しているものの ID。
#[tauri::command]
pub(crate) fn hook_work() -> Vec<String> {
    hooks::pending()
}

#[tauri::command]
pub(crate) fn stop_hooks() {
    hooks::stop();
}

#[tauri::command]
pub(crate) async fn plugins(cur: State<'_, Current>) -> Result<plugin::PluginReport, String> {
    with_session(&cur, |s| {
        let mut r = s.plugins.report();
        for p in &mut r.plugins {
            p.follow.latest = s.latest.get(&p.id).cloned();
        }
        Ok(r)
    })
}

/// 取ってきて、入れるかを確かめてもらっているもの。
#[derive(Default)]
pub(crate) struct Staging(Mutex<HashMap<String, Pending>>);

struct Pending {
    root: PathBuf,
    staged: install::Staged,
    enable: bool,
}

/// 入れる前に見せるもの。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Prepared {
    token: String,
    plugin: plugin::PluginStatus,
    /// 入っているものより増えたもの。初めて入れるときは全部。
    added: install::Risk,
    first: bool,
}

impl Staging {
    fn keep(&self, root: &Path, staged: install::Staged, enable: bool) -> Prepared {
        let mut plugin = staged.preview();
        plugin.source = Some(staged.source.clone());
        plugin.follow.tag = staged.tag.clone();
        let prepared = Prepared {
            token: uuid::Uuid::new_v4().simple().to_string(),
            plugin,
            added: staged.added.clone(),
            first: staged.first,
        };
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(
                prepared.token.clone(),
                Pending {
                    root: root.to_owned(),
                    staged,
                    enable,
                },
            );
        prepared
    }

    fn take(&self, token: &str) -> Option<Pending> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(token)
    }
}

/// 記録したプラグインを、記録した取得先から取ってくる。tag がなければ最新のリリースを取る。
fn stage_recorded(
    app: &tauri::AppHandle,
    root: &Path,
    id: &str,
    tag: Option<String>,
) -> Result<install::Staged, String> {
    install::check_id(id)?;
    let r = record::Record::read(&record::path(root))?;
    let e = r
        .plugins
        .get(id)
        .ok_or_else(|| format!("プラグイン「{id}」はライブラリに記録されていません"))?;
    let source = e
        .source
        .clone()
        .ok_or_else(|| format!("プラグイン「{id}」の取得先が記録されていません"))?;
    let dir = make_plugin_dir(app, root)?;
    // 無効にしてあるものは読んでいないので、入っているかはフォルダで確かめる
    let installed = dir.join(id).join(plugin::MANIFEST).is_file();
    let (want, expect) = match (&source, tag) {
        (Source::Local(_), _) => (
            install::Want::Latest { prerelease: false },
            e.hash.as_deref().filter(|_| !installed),
        ),
        (Source::Github(_), Some(t)) => {
            let same = e.tag.as_deref() == Some(t.as_str());
            (install::Want::Tag(t), e.hash.as_deref().filter(|_| same))
        }
        (Source::Github(_), None) => (
            install::Want::Latest {
                prerelease: e.prerelease,
            },
            None,
        ),
    };
    install::stage(
        &source,
        &want,
        &dir,
        &plugin::builtin_ids(),
        expect,
        Some(id),
    )
}

fn place_staged(app: &tauri::AppHandle, cur: &State<Current>, p: &Pending) -> Result<(), String> {
    if root_of(cur)? != p.root {
        return Err("ライブラリが切り替わったため、インストールを中止しました".into());
    }
    let s = &p.staged;
    install::place(s, &plugin_dir(app, &p.root)?)?;
    record::update(&p.root, |r| {
        let e = r.plugins.entry(s.manifest.id.clone()).or_default();
        e.version = Some(s.manifest.version.clone());
        e.source = Some(s.source.clone());
        e.tag = s.tag.clone();
        e.hash = Some(s.hash.clone());
        if p.enable {
            e.disabled = false;
        }
    })?;
    with_session(cur, |ss| {
        if ss.latest.get(&s.manifest.id) == s.tag.as_ref() {
            ss.latest.remove(&s.manifest.id);
        }
        Ok(())
    })
}

/// 新しく入れるものを取ってくる。GitHub は最新のリリースを取る。
#[tauri::command]
pub(crate) async fn prepare_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    staging: State<'_, Staging>,
    source: Source,
) -> Result<Prepared, String> {
    let source = match source {
        Source::Github(url) => Source::Github(plugin::github::repo_of(&url)?),
        s => s,
    };
    let root = root_of(&cur)?;
    let dir = make_plugin_dir(&app, &root)?;
    let staged = install::stage(
        &source,
        &install::Want::Latest { prerelease: false },
        &dir,
        &plugin::builtin_ids(),
        None,
        None,
    )?;
    Ok(staging.keep(&root, staged, true))
}

/// 記録したプラグインを、入れ直すか更新するために取ってくる。
#[tauri::command]
pub(crate) async fn prepare_update(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    staging: State<'_, Staging>,
    id: String,
    tag: Option<String>,
) -> Result<Prepared, String> {
    let root = root_of(&cur)?;
    let staged = stage_recorded(&app, &root, &id, tag)?;
    Ok(staging.keep(&root, staged, false))
}

#[tauri::command]
pub(crate) async fn commit_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    staging: State<'_, Staging>,
    token: String,
) -> Result<(), String> {
    let p = staging
        .take(&token)
        .ok_or("取得したプラグインが見つかりません")?;
    place_staged(&app, &cur, &p)
}

#[tauri::command]
pub(crate) fn cancel_plugin(staging: State<'_, Staging>, token: String) {
    staging.take(&token);
}

fn remember_latest(
    cur: &State<Current>,
    id: &str,
    recorded: Option<&String>,
    tag: &str,
) -> Result<(), String> {
    with_session(cur, |s| {
        if recorded.is_some_and(|r| r == tag) {
            s.latest.remove(id);
        } else {
            s.latest.insert(id.to_owned(), tag.to_owned());
        }
        Ok(())
    })
}

/// GitHub の最新のリリースのタグ。
#[tauri::command]
pub(crate) async fn plugin_latest(cur: State<'_, Current>, id: String) -> Result<String, String> {
    let root = root_of(&cur)?;
    let r = record::Record::read(&record::path(&root))?;
    let e = r
        .plugins
        .get(&id)
        .ok_or_else(|| format!("プラグイン「{id}」はライブラリに記録されていません"))?;
    let Some(Source::Github(repo)) = &e.source else {
        return Err(format!(
            "プラグイン「{id}」は GitHub からインストールしたものではありません"
        ));
    };
    let tag = plugin::github::latest(repo, e.prerelease)?.tag;
    remember_latest(&cur, &id, e.tag.as_ref(), &tag)?;
    Ok(tag)
}

/// 更新を確認するときに、プレリリースも対象にするか。変えたら、調べた最新のタグは忘れる。
#[tauri::command]
pub(crate) async fn set_plugin_prerelease(
    cur: State<'_, Current>,
    id: String,
    prerelease: bool,
) -> Result<(), String> {
    install::check_id(&id)?;
    let root = root_of(&cur)?;
    record::update(&root, |r| {
        if let Some(e) = r.plugins.get_mut(&id) {
            e.prerelease = prerelease;
        }
    })?;
    with_session(&cur, |s| {
        s.latest.remove(&id);
        Ok(())
    })
}

#[tauri::command]
pub(crate) async fn set_plugin_enabled(
    cur: State<'_, Current>,
    id: String,
    dev: bool,
    enabled: bool,
) -> Result<(), String> {
    let root = root_of(&cur)?;
    let builtin = !dev && plugin::builtin_ids().contains(&id);
    if !dev
        && !builtin
        && !record::Record::read(&record::path(&root))?
            .plugins
            .contains_key(&id)
    {
        return Err(format!(
            "プラグイン「{id}」はライブラリに記録されていません"
        ));
    }
    record::update(&root, |r| {
        if builtin {
            if enabled {
                r.plugins.remove(&id);
            } else {
                r.plugins.entry(id).or_default().disabled = true;
            }
        } else if !dev {
            if let Some(e) = r.plugins.get_mut(&id) {
                e.disabled = !enabled;
            }
        } else if enabled {
            r.dev.insert(id);
        } else {
            r.dev.remove(&id);
        }
    })
}

#[tauri::command]
pub(crate) async fn remove_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
) -> Result<(), String> {
    install::check_id(&id)?;
    let root = root_of(&cur)?;
    record::update(&root, |r| {
        r.plugins.remove(&id);
    })?;
    record::forget(&root, &id)?;
    let unused = unused_plugins_of(&app, &cur)?;
    remove_plugins(unused.into_iter().filter(|(u, _)| u.id == id).collect())
}

#[tauri::command]
pub(crate) async fn pick_plugin(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    app.dialog()
        .file()
        .set_title("プラグインの ZIP ファイルを選択")
        .add_filter("zip", &["zip"])
        .blocking_pick_file()
        .map(|p| p.into_path().map_err(|e| e.to_string()))
        .transpose()
}

/// 設定を変え、その設定を読んで作ったサムネイルを作り直す。
/// WASM が作るものは裏で作り、組み込み UI が作るものは返す（画面が作る）。
#[tauri::command]
pub(crate) async fn set_plugin_setting(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    key: String,
    value: Value,
) -> Result<Vec<StoredItem>, String> {
    let (plugins, thumbs, cache) = with_session(&cur, |s| {
        s.plugins.set_setting(&id, &key, &value)?;
        Ok((Arc::clone(&s.plugins), s.thumbs.clone(), s.lib.cache()))
    })?;
    let reads = cache.thumb_reads()?;
    if !reads.values().any(|r| r.contains_key(&key)) {
        return Ok(Vec::new());
    }
    let mut items: Vec<StoredItem> = cache
        .rows()?
        .into_values()
        .map(|r| r.item)
        .filter(|it| {
            plugins.thumb_owner(&it.ext) == Some(id.as_str())
                && reads.get(&it.file).is_some_and(|r| r.contains_key(&key))
        })
        .collect();
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut items);
    // 前の値に戻したときなど、いまの値で作ったものが残っていれば、作り直さずにそれへ切り替える
    for it in &items {
        if let (Some(file), Some(size)) = (&it.thumb, it.width.zip(it.height)) {
            let now = reads_now(&plugins, reads.get(&it.file), &it.ext);
            tell_thumb(&app, &cache, &it.id, &it.file, file, size, &now);
        }
    }
    items.retain(|it| {
        it.thumb.is_none() && plugins.handles(&it.ext, Part::Thumbnail) == Some(By::Script)
    });
    if !jobs.is_empty() {
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    Ok(items)
}
