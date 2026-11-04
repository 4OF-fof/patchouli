mod background;
pub mod cache;
mod content;
mod cover;
mod decisions;
mod embed;
mod hooks;
pub mod import;
pub mod library;
pub mod note;
mod orphan;
pub mod plugin;
mod search;
mod settings;
mod shell;
mod suggest;
pub mod thumb;
mod tidy;
mod vectors;
mod web;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use cache::Cache;
use library::{
    ItemPatch, Library, LibraryState, ListDiff, Opened, Place, StoredItem, StoredProject,
};
use plugin::record::{self, Source};
use plugin::{
    Action, By, Env, ItemInfo, MenuRun, MenuShown, Part, Ran, Reads, Registry, Runner, TargetFile,
    UiOwner, UiRef, ViewOut,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Current(Mutex<Option<Session>>);

impl Current {
    /// 持っていたスレッドが落ちても、ライブラリは開いたままにする。
    fn lock(&self) -> MutexGuard<'_, Option<Session>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

struct Session {
    /// 素材を読み直すたびに変わる。裏の突き合わせが、読み直す前の結果を持ち込まないようにする。
    id: u64,
    lib: Library,
    thumbs: PathBuf,
    plugins: Arc<Registry>,
    /// 詳細の表示に使う。プラグインが長く動いてもほかの操作を止めないよう、Session のロックを放してから使う。
    runner: Arc<Mutex<Runner>>,
    ui_reads: HashMap<String, Reads>,
}

#[cfg(debug_assertions)]
fn dev_path(var: &str, dir: &str) -> PathBuf {
    std::env::var_os(var).map_or_else(
        || {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../example")
                .join(dir)
        },
        PathBuf::from,
    )
}

fn plugin_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Ok(dev_path("PATCHOULI_PLUGIN_DIR", "dev-plugins"))
    }
    #[cfg(not(debug_assertions))]
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins"))
}

fn next_session() -> u64 {
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

fn dev_unpack_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(cache_dir(app).ok()?.join("dev-plugins"))
}

fn dev_places(app: &tauri::AppHandle) -> Option<plugin::Dev> {
    let d = settings::developer(app)
        .inspect_err(|e| log::warn!("開発者モードの設定を読めない: {e}"))
        .ok()
        .filter(|d| d.enabled)?;
    Some(plugin::Dev {
        dirs: d.plugin_dirs,
        repos: d.repos,
        unpack: dev_unpack_dir(app)?,
    })
}

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map_err(|e| e.to_string())
}

fn plugin_ids(root: &Path) -> Option<Vec<String>> {
    if !root.is_dir() {
        return None;
    }
    let r = record::Record::read(&record::path(root)).ok()?;
    Some(r.plugins.into_keys().collect())
}

fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("PATCHOULI_LIBRARY") {
        return Ok(PathBuf::from(p));
    }
    if let Some(p) = settings::library(app)? {
        return Ok(p);
    }
    #[cfg(debug_assertions)]
    return Ok(dev_path("PATCHOULI_LIBRARY", "dev-library"));
    #[cfg(not(debug_assertions))]
    Err("ライブラリが選択されていません。設定から選択してください".into())
}

fn with<T>(
    cur: &State<Current>,
    f: impl FnOnce(&mut Library) -> Result<T, String>,
) -> Result<T, String> {
    with_session(cur, |s| f(&mut s.lib))
}

fn with_session<T>(
    cur: &State<Current>,
    f: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut g = cur.lock();
    let s = g.as_mut().ok_or("ライブラリを開いていません")?;
    f(s)
}

struct Target {
    id: String,
    path: PathBuf,
    ext: String,
    note: bool,
    runner: Arc<Mutex<Runner>>,
    plugins: Arc<Registry>,
    thumbs: PathBuf,
}

impl Target {
    fn of(cur: &State<Current>, id: &str) -> Result<Target, String> {
        with_session(cur, |s| s.lib.asset(id).map(|_| ()))?;
        Target::any(cur, id)
    }

    /// ノートも受け取る。右クリックメニューに使う。
    fn any(cur: &State<Current>, id: &str) -> Result<Target, String> {
        with_session(cur, |s| {
            let (path, ext, note) = s.lib.file(id)?;
            Ok(Target {
                id: id.to_owned(),
                path: path.to_owned(),
                ext,
                note,
                runner: Arc::clone(&s.runner),
                plugins: Arc::clone(&s.plugins),
                thumbs: s.thumbs.clone(),
            })
        })
    }

    /// プラグインを呼ぶ。ほかの呼び出しが使っているあいだは待たず、新しく作って使う。
    fn run<T>(&self, f: impl FnOnce(&mut Runner, &str, &Path) -> T) -> T {
        self.runner(|r| f(r, &self.ext, &self.path))
    }

    fn runner<T>(&self, f: impl FnOnce(&mut Runner) -> T) -> T {
        match self.runner.try_lock() {
            Ok(mut r) => f(&mut r),
            Err(_) => f(&mut Runner::new(Arc::clone(&self.plugins))),
        }
    }

    fn item(&self) -> ElevatedItem {
        ElevatedItem {
            id: self.id.clone(),
            name: self
                .path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            ext: self.ext.clone(),
            file: self.path.clone(),
        }
    }
}

/// elevated に渡す素材。
#[derive(Serialize)]
struct ElevatedItem {
    id: String,
    name: String,
    ext: String,
    file: PathBuf,
}

/// elevated が受け持つときに、画面に呼んでもらう先。
#[derive(Serialize)]
struct Elevated {
    #[serde(flatten)]
    ui: UiRef,
    items: Vec<ElevatedItem>,
}

fn targets(cur: &State<Current>, ids: &[String]) -> Result<Vec<Target>, String> {
    ids.iter().map(|id| Target::any(cur, id)).collect()
}

fn info_of(it: StoredItem) -> ItemInfo {
    ItemInfo {
        id: it.id,
        name: it.name,
        note: it.note,
        project: it.project,
        tags: it.tags,
        memo: it.memo,
    }
}

/// library・embed がライブラリを引く窓口。
fn env_of(app: &tauri::AppHandle, thumbs: &Path) -> Arc<Env> {
    let a = app.clone();
    Arc::new(Env {
        ai: embed::installed() && settings::auto_tag(app).unwrap_or(false),
        thumbs: thumbs.to_owned(),
        info: Arc::new(move |id| {
            with_session(&a.state::<Current>(), |s| Ok(s.lib.stored(id)))
                .ok()
                .flatten()
                .map(info_of)
        }),
    })
}

/// 選んだものをまとめて plugin のメニューに渡す。
fn run_menu_of<T>(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    ts: &[Target],
    f: impl FnOnce(&mut Runner, &[TargetFile]) -> Result<T, String>,
) -> Result<T, String> {
    let first = ts.first().ok_or("素材を選んでいません")?;
    let infos: Vec<Option<ItemInfo>> = with(cur, |l| {
        Ok(ts.iter().map(|t| l.stored(&t.id).map(info_of)).collect())
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
enum MenuOutput {
    Overlay {
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        rows: Vec<Detail>,
    },
    Screen {
        id: String,
        window: bool,
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
#[derive(Serialize, Default)]
struct MenuDone {
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
        MenuShown::Screen { id, window } => Some(MenuOutput::Screen { id, window }),
    };
    let ids: Vec<String> = ts.iter().map(|t| t.id.clone()).collect();
    let a = apply_ran(app, cur, &ids, run.ran)?;
    Ok(MenuDone {
        output,
        copy: a.copy,
        items: a.added,
        saved: a.saved,
        failed: a.failed,
    })
}

/// 頼まれたことを起こした結果。
#[derive(Default)]
struct Applied {
    copy: Option<String>,
    added: Vec<StoredItem>,
    saved: Option<PathBuf>,
    failed: Vec<String>,
}

/// run-menu・added で頼まれたことを起こす。作るものの置き場は ids の先頭と同じにする。
/// 書き換えたものは library-changed で画面に知らせる。
fn apply_ran(
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
            .and_then(|id| s.lib.stored(id))
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
                && let Some(it) = s.lib.stored(id)
            {
                renamed.entry(id.clone()).or_insert(it.name);
            }
            match edit_item(&mut s.lib, ids, a) {
                Ok(id) if !edited.contains(&id) => edited.push(id),
                Ok(_) => {}
                Err(e) => out.failed.push(e),
            }
        }
        changed.extend(edited.iter().filter_map(|id| s.lib.stored(id)));
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
            .ok_or_else(|| "書き換えるものが見つかりません".to_owned())
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
            let old = lib.stored(&id).map(|it| it.tags).unwrap_or_default();
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
    std::fs::copy(from, &to).map_err(|e| format!("「{}」に書き出せません：{e}", to.display()))?;
    Ok(Some(to))
}

/// 書き出す先を聞く。name は既定の名前。
fn save_dialog(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("書き出す場所を選択")
        .set_file_name(name);
    if let Some(ext) = Path::new(name).extension().and_then(|x| x.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    dialog.blocking_save_file()?.into_path().ok()
}

// 登録する名前にする。作業用の置き場の中で名前を変える。
fn named(path: PathBuf, name: Option<String>, failed: &mut Vec<String>) -> PathBuf {
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
            failed.push(format!("「{name}」に名前を変えられません：{e}"));
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
fn menu_sides(ts: &[Target]) -> Vec<plugin::MenuSide> {
    let Some(first) = ts.first() else {
        return Vec::new();
    };
    let keys: Vec<_> = ts.iter().map(|t| (t.ext.as_str(), t.note)).collect();
    first.plugins.menus(&keys)
}

fn elevated_of(ui: UiRef, ts: &[Target]) -> Elevated {
    Elevated {
        ui,
        items: ts.iter().map(Target::item).collect(),
    }
}

fn reads_now(plugins: &Registry, before: Option<&Reads>, ext: &str) -> Reads {
    before.map_or_else(Reads::new, |r| {
        r.keys()
            .map(|k| (k.clone(), plugins.thumb_setting(ext, k)))
            .collect()
    })
}

/// サムネイルがあるか。置き場には項目の数だけファイルがあり、1 つずつ確かめると遅いので、フォルダごとに一度に読む
#[derive(Default)]
struct Present(HashMap<PathBuf, HashSet<std::ffi::OsString>>);

impl Present {
    fn names(&mut self, dir: &Path) -> &mut HashSet<std::ffi::OsString> {
        self.0.entry(dir.to_owned()).or_insert_with(|| {
            std::fs::read_dir(dir)
                .map(|rd| rd.flatten().map(|e| e.file_name()).collect())
                .unwrap_or_default()
        })
    }

    fn has(&mut self, p: &Path) -> bool {
        match (p.parent(), p.file_name()) {
            (Some(dir), Some(name)) => self.names(dir).contains(name),
            _ => p.exists(),
        }
    }

    fn forget(&mut self, p: &Path) {
        if let (Some(dir), Some(name)) = (p.parent(), p.file_name()) {
            self.names(dir).remove(name);
        }
    }
}

/// 元のファイルの更新日時と大きさ。Windows ではフォルダを読んだときに届くので、フォルダごとに一度に読む
#[derive(Default)]
struct Stats(HashMap<PathBuf, HashMap<std::ffi::OsString, std::fs::Metadata>>);

impl Stats {
    fn of(&mut self, p: &Path) -> Option<std::fs::Metadata> {
        if let (Some(dir), Some(name)) = (p.parent(), p.file_name()) {
            let list = self.0.entry(dir.to_owned()).or_insert_with(|| {
                std::fs::read_dir(dir)
                    .map(|rd| {
                        rd.flatten()
                            .filter_map(|e| Some((e.file_name(), e.metadata().ok()?)))
                            // リンクは、たどった先を問い合わせる
                            .filter(|(_, m)| !m.file_type().is_symlink())
                            .collect()
                    })
                    .unwrap_or_default()
            });
            if let Some(m) = list.get(name) {
                return Some(m.clone());
            }
        }
        std::fs::metadata(p).ok()
    }
}

fn plan_thumbs<'a>(
    plugins: &Registry,
    thumbs: &Path,
    cache: &Cache,
    items: impl IntoIterator<Item = &'a mut StoredItem>,
) -> (Vec<thumb::Job>, Vec<PathBuf>, bool) {
    let reads = cache.thumb_reads();
    let mixed = cache.take_mixed_thumbs();
    let mut made = Present::default();
    let mut stats = Stats::default();
    let mut jobs = Vec::new();
    let mut current = Vec::new();
    let mut all = true;
    for it in items {
        // 写しにあった場所は、消されていることもあるので確かめ直す
        it.thumb = None;
        it.wave_thumb = false;
        // 波形を作るものは、波形をサムネイルにすることがある
        let by = plugins.handles(&it.ext, Part::Thumbnail);
        let waves = plugins.handles(&it.ext, Part::Waveform).is_some();
        if by.is_none() && !waves {
            continue;
        }
        // 値が変わっていれば、場所が変わって作り直しになる
        let now = reads_now(plugins, reads.get(&it.file), &it.ext);
        let Some(src) = stats.of(&it.file) else {
            all = false;
            continue;
        };
        let Some(out) = thumb::path_of(thumbs, &it.id, &src, &now) else {
            all = false;
            continue;
        };
        current.push(out.clone());
        // 前の版は、波形から描いたものもジャケットと同じ場所に置いていて、見分けられないので作り直す
        if mixed && waves {
            let _ = std::fs::remove_file(&out);
            made.forget(&out);
        }
        let drawn = waves
            .then(|| thumb::wave_thumb_path_of(thumbs, &it.id, &src))
            .flatten();
        let found = if made.has(&out) {
            Some(out)
        } else {
            drawn.filter(|p| made.has(p))
        };
        if let Some(found) = found {
            if it.width.is_none()
                && let Ok(s) = imagesize::size(&found)
            {
                (it.width, it.height) = (Some(s.width as u32), Some(s.height as u32));
            }
            it.wave_thumb = thumb::is_wave_thumb(&found);
            it.thumb = Some(found);
        } else if by == Some(By::Sandbox) {
            thumb::start_making(&it.file);
            jobs.push(thumb::Job {
                id: it.id.clone(),
                src: it.file.clone(),
                ext: it.ext.clone(),
                dir: thumbs.to_owned(),
                mtime: it.mtime,
            });
        }
    }
    (jobs, current, all)
}

/// 裏でサムネイルを作り、できたものから画面へ知らせる。
/// プラグインが作らなかったもので、波形がもうあれば、波形をサムネイルにする。
fn make_thumbs(
    app: &tauri::AppHandle,
    plugins: &Arc<Registry>,
    cache: &Cache,
    jobs: Vec<thumb::Job>,
) {
    thumb::make_all(plugins, jobs, |j, p| {
        thumb::end_making(&j.src);
        let made = match p {
            Some(p) => {
                tell_thumb(app, cache, &j.id, &j.src, &p.out, p.size, &p.reads);
                Ok(())
            }
            None => wave_thumb(app, cache, plugins, &j.dir, &j.id, &j.src, &j.ext),
        };
        if let Err(e) = made {
            log::warn!("波形をサムネイルにできない: {e}");
        }
    })
}

fn wave_thumb(
    app: &tauri::AppHandle,
    cache: &Cache,
    plugins: &Registry,
    thumbs: &Path,
    id: &str,
    src: &Path,
    ext: &str,
) -> Result<(), String> {
    let err = || format!("{} の読み込みに失敗しました", src.display());
    let Some(wave) = thumb::wave_path(thumbs, id, src).and_then(|p| std::fs::read(p).ok()) else {
        return Ok(());
    };
    let reads = reads_now(plugins, cache.thumb_read(src).as_ref(), ext);
    // プラグインが作ったもの（音声ならジャケット）があれば、そちらをサムネイルにする
    if thumb::path_for(thumbs, id, src, &reads)
        .ok_or_else(err)?
        .exists()
    {
        return Ok(());
    }
    let out = thumb::wave_thumb_path(thumbs, id, src).ok_or_else(err)?;
    if out.exists() {
        return Ok(());
    }
    let png = thumb::draw_wave(&wave, plugins.ratio_of(ext))?;
    let size = imagesize::blob_size(&png).map_err(|e| format!("{}: {e}", src.display()))?;
    thumb::keep(&out, &png);
    if !out.exists() {
        return Err(err());
    }
    tell_thumb(
        app,
        cache,
        id,
        src,
        &out,
        (size.width as u32, size.height as u32),
        &reads,
    );
    Ok(())
}

fn tell_thumb(
    app: &tauri::AppHandle,
    cache: &Cache,
    id: &str,
    src: &Path,
    file: &Path,
    (width, height): (u32, u32),
    reads: &Reads,
) {
    cache.set_thumb(src, file, (width, height), reads);
    let _ = app.emit(
        "thumbnail",
        ThumbReady {
            id,
            file,
            width,
            height,
            wave: thumb::is_wave_thumb(file),
        },
    );
}

/// 開いているライブラリのロック。ほかのアプリが同じライブラリを開いて、キャッシュやメタ情報を書き合わないようにする。
static LOCKED: Mutex<Option<(PathBuf, std::fs::File)>> = Mutex::new(None);

fn lock_library(root: &Path) -> Result<(), String> {
    let mut held = LOCKED.lock().unwrap_or_else(|e| e.into_inner());
    if held.as_ref().is_some_and(|(r, _)| r == root) {
        return Ok(());
    }
    let dir = root.join(library::STATE_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("lock");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    match file.try_lock() {
        Ok(()) => {
            *held = Some((root.to_owned(), file));
            Ok(())
        }
        Err(std::fs::TryLockError::WouldBlock) => Err(format!(
            "このライブラリ（{}）は別のウィンドウで開いています",
            root.display()
        )),
        Err(std::fs::TryLockError::Error(e)) => Err(format!("{}: {e}", path.display())),
    }
}

#[tauri::command]
async fn open_library(app: tauri::AppHandle, cur: State<'_, Current>) -> Result<Opened, String> {
    let root = library::canonical(&library_root(&app)?)?;
    lock_library(&root)?;
    let (plugins, plugin_problems) =
        Registry::open(&root, &plugin_dir(&app)?, dev_places(&app).as_ref());
    let plugins = Arc::new(plugins);
    if let Err(e) = settings::remember(&app, &root, plugin_ids(&root).unwrap_or_default()) {
        log::warn!("開いたライブラリを覚えられない: {e}");
    }
    let cache_dir = cache_dir(&app)?;
    let cache_path = cache::path_for(&cache_dir, &root);
    cache::touch(&cache_path);
    let cache = Arc::new(Cache::open(&cache_path));
    {
        let (dir, root) = (cache_dir.clone(), root.clone());
        background::spawn(move || cache::sweep(&dir, &root));
    }
    let thumbs = thumb::dir_for(&cache_dir, &root);
    std::fs::create_dir_all(&thumbs).map_err(|e| format!("{}: {e}", thumbs.display()))?;
    let scope = app.asset_protocol_scope();
    for dir in [&root, &thumbs] {
        scope
            .allow_directory(dir, true)
            .map_err(|e| e.to_string())?;
    }
    let (lib, mut opened, checking) =
        match Library::cached(&root, Arc::clone(&plugins), Arc::clone(&cache)) {
            Some((lib, opened)) => (lib, opened, true),
            None => {
                let since = std::time::SystemTime::now();
                let (lib, mut scan) =
                    Library::scan(&root, Arc::clone(&plugins), Arc::clone(&cache));
                let thumbs_job = plan_thumbs(
                    &plugins,
                    &thumbs,
                    &cache,
                    scan.items.iter_mut().map(|r| &mut r.item),
                );
                let all_found = thumbs_job.2 && scan.problems.is_empty();
                let opened = lib.opened(scan);
                spawn_thumbs(
                    &app, &plugins, &cache, &thumbs, thumbs_job, all_found, since,
                );
                (lib, opened, false)
            }
        };
    opened.problems.extend(plugin_problems);
    let runner = Arc::new(Mutex::new(Runner::new(Arc::clone(&plugins))));
    let id = next_session();
    *cur.lock() = Some(Session {
        id,
        lib,
        thumbs: thumbs.clone(),
        plugins: Arc::clone(&plugins),
        runner,
        ui_reads: HashMap::new(),
    });
    // キャッシュから開いたときは、確かめ終えてから作る
    if !checking && settings::auto_tag(&app).unwrap_or(false) {
        content::collect(&app, &plugins, &opened.items, &thumbs);
    }
    if checking {
        CHECKING.fetch_add(1, Ordering::Relaxed);
        background::spawn(move || {
            check(&app, id, &root, &plugins, &cache, &thumbs);
            CHECKING.fetch_sub(1, Ordering::Relaxed);
        });
    }
    Ok(opened)
}

#[tauri::command]
async fn reload_plugins(
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
    let (plugins, problems) = Registry::open(&root, &plugin_dir(&app)?, dev_places(&app).as_ref());
    let plugins = Arc::new(plugins);
    let since = std::time::SystemTime::now();
    let (mut opened, thumbs, cache) = with_session(&cur, |s| {
        s.lib.set_plugins(Arc::clone(&plugins));
        let opened = s.lib.snapshot();
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
fn plugin_work() -> Vec<String> {
    thumb::pending_items()
}

#[tauri::command]
fn stop_plugin_work() {
    thumb::stop();
}

/// 取り込みのフックを待っているものと、いま渡しているものの ID。
#[tauri::command]
fn hook_work() -> Vec<String> {
    hooks::pending()
}

#[tauri::command]
fn stop_hooks() {
    hooks::stop();
}

/// elevated の runMenu が返した save を、聞いた保存先へ書く。やめたときは None。
#[tauri::command]
async fn export_data(
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
    std::fs::write(&to, bytes).map_err(|e| format!("「{}」に書き出せません：{e}", to.display()))?;
    Ok(Some(to))
}

#[tauri::command]
fn seen_thumbs(ids: Vec<String>) {
    thumb::set_seen(ids);
}

static CHECKING: AtomicUsize = AtomicUsize::new(0);

#[tauri::command]
fn checking() -> bool {
    CHECKING.load(Ordering::Relaxed) > 0
}

fn spawn_thumbs(
    app: &tauri::AppHandle,
    plugins: &Arc<Registry>,
    cache: &Arc<Cache>,
    thumbs: &Path,
    (jobs, current, _): (Vec<thumb::Job>, Vec<PathBuf>, bool),
    all_found: bool,
    since: std::time::SystemTime,
) {
    let (app, plugins, cache, dir) = (
        app.clone(),
        Arc::clone(plugins),
        Arc::clone(cache),
        thumbs.to_owned(),
    );
    background::spawn(move || {
        thumb::prune(&dir, &current, all_found, since);
        make_thumbs(&app, &plugins, &cache, jobs);
    });
}

fn check(
    app: &tauri::AppHandle,
    id: u64,
    root: &Path,
    plugins: &Arc<Registry>,
    cache: &Arc<Cache>,
    thumbs: &Path,
) {
    let since = std::time::SystemTime::now();
    let (fresh, mut scan) = Library::scan(root, Arc::clone(plugins), Arc::clone(cache));
    // サムネイルは取り込んだときに作る。アプリの外で足された画像は、見つけた時点で取り込んだものとみなす
    let job = plan_thumbs(
        plugins,
        thumbs,
        cache,
        scan.items.iter_mut().map(|r| &mut r.item),
    );
    let all_found = job.2 && scan.problems.is_empty();
    let cur = app.state::<Current>();
    let changes = {
        let mut g = cur.lock();
        match g.as_mut() {
            Some(s) if s.id == id => {
                let mut changes = s.lib.apply(fresh, scan);
                for it in s.lib.sync_link_names(&changes.renamed) {
                    changes.items.retain(|x| x.id != it.id);
                    changes.items.push(it);
                }
                changes
            }
            _ => return,
        }
    };
    // 何もないのに送ると、画面がライブラリを作り直してしまう
    if !changes.is_empty() {
        let _ = app.emit("library-changed", &changes);
    }
    let items = settings::auto_tag(app)
        .unwrap_or(false)
        .then(|| with_session(&cur, |s| Ok((s.id == id).then(|| s.lib.snapshot().items))))
        .and_then(Result::ok)
        .flatten();
    if let Some(items) = items {
        content::collect(app, plugins, &items, thumbs);
    }
    spawn_thumbs(app, plugins, cache, thumbs, job, all_found, since);
}

#[tauri::command]
async fn inspect_drop(
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
) -> Result<import::DropInfo, String> {
    let root = with_session(&cur, |s| Ok(s.lib.root().to_owned())).ok();
    Ok(import::inspect(&paths, root.as_deref()))
}

/// ファイルのコピーはロックの外で行い、ロックは置き場所を決めるときと、項目を覚えるときだけ取る。
fn import_paths(
    cur: &State<Current>,
    paths: &[PathBuf],
    place: &Place,
    mv: bool,
) -> Result<import::Imported, String> {
    let root = with_session(cur, |s| Ok(s.lib.root().to_owned()))?;
    let found = import::gather(paths, &root);
    let mut plan = with_session(cur, |s| s.lib.plan_import(found, place))?;
    let mut staged = import::stage(&mut plan, mv);
    let r = with_session(cur, |s| s.lib.finish_import(plan, &mut staged, mv));
    import::unstage(staged, mv);
    r
}

#[tauri::command]
async fn import_files(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    paths: Vec<PathBuf>,
    place: Place,
) -> Result<import::Imported, String> {
    let mv = settings::app_settings(&app)?.import_mode == settings::ImportMode::Move;
    let mut out = import_paths(&cur, &paths, &place, mv)?;
    let (thumbs, plugins, cache) = with_session(&cur, |s| {
        Ok((s.thumbs.clone(), Arc::clone(&s.plugins), s.lib.cache()))
    })?;
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut out.items);
    hooks::queue(&app, &out.items);
    if !jobs.is_empty() {
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    Ok(out)
}

#[tauri::command]
async fn import_data(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<StoredItem, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("リクエスト本文がファイルの中身ではありません".into());
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let meta: (String, Place) = head("meta")
        .map(serde_json::from_str)
        .ok_or("ファイル名が指定されていません")?
        .map_err(|e| format!("meta の読み込みに失敗しました：{e}"))?;
    let (name, place) = meta;
    let (item, thumbs, plugins, cache) = with_session(&cur, |s| {
        Ok((
            s.lib.import_data(&name, bytes, &place)?,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
        ))
    })?;
    let mut items = vec![item];
    let (jobs, _, _) = plan_thumbs(&plugins, &thumbs, &cache, &mut items);
    hooks::queue(&app, &items);
    if !jobs.is_empty() {
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    items.pop().ok_or_else(|| "取り込みに失敗しました".into())
}

#[derive(Clone, Serialize)]
struct ThumbReady<'a> {
    id: &'a str,
    file: &'a Path,
    width: u32,
    height: u32,
    wave: bool,
}

#[tauri::command]
async fn plugins(cur: State<'_, Current>) -> Result<plugin::PluginReport, String> {
    with_session(&cur, |s| Ok(s.plugins.report()))
}

fn root_of(cur: &State<Current>) -> Result<PathBuf, String> {
    with(cur, |l| Ok(l.root().to_owned()))
}

fn install_from(
    app: &tauri::AppHandle,
    cur: &State<Current>,
    source: Source,
    expect: Option<&str>,
    update: Option<&str>,
    enable: bool,
) -> Result<(), String> {
    let root = root_of(cur)?;
    let (m, hash) = plugin::install::install(
        &source,
        &plugin_dir(app)?,
        &plugin::builtin_ids(),
        expect,
        update,
    )?;
    record::update(&root, |r| {
        let e = r.plugins.entry(m.id).or_default();
        e.version = Some(m.version);
        e.source = Some(source);
        e.hash = Some(hash);
        if enable {
            e.disabled = false;
        }
    })
}

#[tauri::command]
async fn install_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    source: Source,
) -> Result<(), String> {
    install_from(&app, &cur, source, None, None, true)
}

#[tauri::command]
async fn update_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
) -> Result<(), String> {
    plugin::install::check_id(&id)?;
    let recorded = with_session(&cur, |s| Ok(s.plugins.source_of(&id)))?;
    let (source, hash) = recorded.ok_or_else(|| format!("{id} の取得先が記録されていません"))?;
    // 無効にしてあるものは読んでいないので、入っているかはフォルダで確かめる
    let installed = plugin_dir(&app)?.join(&id).join(plugin::MANIFEST).is_file();
    let expect = hash.as_deref().filter(|_| !installed);
    install_from(&app, &cur, source, expect, Some(&id), false)
}

#[tauri::command]
async fn set_plugin_enabled(
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
async fn developer(app: tauri::AppHandle) -> Result<settings::Developer, String> {
    settings::developer(&app)
}

#[tauri::command]
async fn set_developer(
    app: tauri::AppHandle,
    developer: settings::Developer,
) -> Result<(), String> {
    settings::set_developer(&app, &developer)
}

fn apply_app_settings(s: &settings::AppSettings) {
    thumb::set_large(s.thumb_size == settings::ThumbSize::Large);
    plugin::commands::set_fixed(s.command_paths.clone());
}

#[tauri::command]
async fn app_settings(app: tauri::AppHandle) -> Result<settings::AppSettings, String> {
    settings::app_settings(&app)
}

/// サムネイルの大きさを変えたときは、作り直すためにサムネイルのキャッシュを消す。
#[tauri::command]
async fn set_app_settings(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    settings: settings::AppSettings,
) -> Result<(), String> {
    let before = settings::app_settings(&app)?;
    let resize = before.thumb_size != settings.thumb_size;
    let root = if resize {
        let root = root_of(&cur)?;
        close_for_clearing(&app, &cur)?;
        Some(root)
    } else {
        None
    };
    settings::set_app_settings(&app, &settings)?;
    apply_app_settings(&settings);
    if let Some(root) = root {
        tidy::clear(&cache_dir(&app)?, &root, tidy::Kind::Thumbs)?;
    }
    Ok(())
}

/// キャッシュを消す前に、裏の仕事を止めて終わるのを待ち、ライブラリを閉じる。
fn close_for_clearing(app: &tauri::AppHandle, cur: &State<Current>) -> Result<(), String> {
    const LIMIT: std::time::Duration = std::time::Duration::from_secs(60);
    thumb::stop();
    content::stop(app);
    suggest::stop();
    if !background::wait(LIMIT) {
        return Err("裏で動いている処理が終わらないため、キャッシュを消せませんでした。少し待ってから、やり直してください".into());
    }
    let closed = cur.lock().take();
    if let Some(s) = closed {
        s.plugins.stop();
    }
    // 閉じる前に始まったものを待つ。閉じたあとは、新しく始まらない
    if !background::wait(LIMIT) {
        log::warn!("裏の処理が終わらないまま、キャッシュを消す");
    }
    Ok(())
}

#[tauri::command]
async fn pick_command(app: tauri::AppHandle, name: String) -> Result<Option<PathBuf>, String> {
    let Some(p) = app
        .dialog()
        .file()
        .set_title(format!("{name} の場所を選択"))
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    p.into_path().map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_dev_path(app: tauri::AppHandle, repo: bool) -> Result<Option<PathBuf>, String> {
    let title = if repo {
        "プラグインのリポジトリを選択"
    } else {
        "開発用プラグインのフォルダを選択"
    };
    let Some(p) = app.dialog().file().set_title(title).blocking_pick_folder() else {
        return Ok(None);
    };
    let p = p.into_path().map_err(|e| e.to_string())?;
    if repo && !p.join(plugin::MANIFEST).is_file() {
        return Err(format!(
            "{}: {} が見つかりません",
            p.display(),
            plugin::MANIFEST
        ));
    }
    Ok(Some(p))
}

#[tauri::command]
async fn remove_plugin(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
) -> Result<(), String> {
    plugin::install::check_id(&id)?;
    let root = root_of(&cur)?;
    record::update(&root, |r| {
        r.plugins.remove(&id);
    })?;
    record::forget(&root, &id)?;
    let unused = unused_plugins_of(&app, &cur)?;
    remove_plugins(unused.into_iter().filter(|(u, _)| u.id == id).collect())
}

#[tauri::command]
async fn pick_plugin(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
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
async fn set_plugin_setting(
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
    if let Some(format) = key.strip_prefix(&plugin::keep_decoded_key(""))
        && value == Value::Bool(false)
    {
        let dir = thumb::decoded_dir(&thumbs, &id, format);
        if let Err(e) = std::fs::remove_dir_all(&dir)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            log::warn!("詳細用の画像を消せない: {}: {e}", dir.display());
        }
    }
    let reads = cache.thumb_reads();
    if !reads.values().any(|r| r.contains_key(&key)) {
        return Ok(Vec::new());
    }
    let mut items: Vec<StoredItem> = cache
        .rows()
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
        it.thumb.is_none() && plugins.handles(&it.ext, Part::Thumbnail) == Some(By::Elevated)
    });
    if !jobs.is_empty() {
        background::spawn(move || make_thumbs(&app, &plugins, &cache, jobs));
    }
    Ok(items)
}

#[tauri::command]
async fn item_view(cur: State<'_, Current>, id: String) -> Result<Option<ViewOut>, String> {
    Ok(Target::of(&cur, &id)?.run(|r, ext, path| r.view(ext, path)))
}

#[derive(Serialize)]
struct Detail {
    label: String,
    value: String,
}

#[derive(Serialize)]
struct MenuEntry {
    id: String,
    label: String,
}

#[derive(Serialize)]
struct Details {
    size: u64,
    rows: Vec<Detail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elevated: Option<Elevated>,
    /// URL ごとに受け持つものが行を作るときの、link を受け持つもの。
    #[serde(skip_serializing_if = "Option::is_none")]
    link: Option<Elevated>,
}

fn rows_of(rows: Vec<(String, String)>) -> Vec<Detail> {
    rows.into_iter()
        .map(|(label, value)| Detail { label, value })
        .collect()
}

fn entries_of(items: Vec<(String, String)>) -> Vec<MenuEntry> {
    items
        .into_iter()
        .map(|(id, label)| MenuEntry { id, label })
        .collect()
}

/// elevated が受け持つときは、行を作らずに elevated を返す（画面が作る）。
#[tauri::command]
async fn item_details(cur: State<'_, Current>, id: String) -> Result<Details, String> {
    let t = Target::of(&cur, &id)?;
    let size = std::fs::metadata(&t.path)
        .map_err(|e| format!("{}: {e}", t.path.display()))?
        .len();
    if t.plugins.by_link(&t.ext, Part::Details)
        && let Some(ui) = t.plugins.link_of(&t.ext)
    {
        return Ok(Details {
            size,
            rows: Vec::new(),
            elevated: None,
            link: Some(Elevated {
                ui,
                items: vec![t.item()],
            }),
        });
    }
    if let Some(ui) = t.plugins.ui_of(&t.ext, Part::Details) {
        return Ok(Details {
            size,
            rows: Vec::new(),
            elevated: Some(Elevated {
                ui,
                items: vec![t.item()],
            }),
            link: None,
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
        elevated: None,
        link: None,
    })
}

#[tauri::command]
async fn item_decoded(cur: State<'_, Current>, id: String) -> Result<tauri::ipc::Response, String> {
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

#[tauri::command]
async fn reveal_item(cur: State<'_, Current>, id: String) -> Result<(), String> {
    let path = with(&cur, |l| Ok(l.path(&id)?.to_owned()))?;
    shell::reveal(&path)
}

#[tauri::command]
async fn open_item_default(cur: State<'_, Current>, id: String) -> Result<(), String> {
    let path = with(&cur, |l| Ok(l.path(&id)?.to_owned()))?;
    shell::open(&path)
}

#[tauri::command]
async fn item_path(cur: State<'_, Current>, id: String) -> Result<PathBuf, String> {
    with(&cur, |l| Ok(l.path(&id)?.to_owned()))
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    shell::open_url(&web::parse(&url)?)
}

/// plugin が None のときは、本体（どの links にも当てはまらない URL の OGP など）が取りに行く。
#[tauri::command]
async fn plugin_fetch(
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
async fn browser_show(
    app: tauri::AppHandle,
    pages: State<'_, web::Pages>,
    key: String,
    url: String,
    bounds: web::Bounds,
) -> Result<(), String> {
    web::show(&app, &pages, &key, &url, bounds)
}

#[tauri::command]
async fn browser_go(app: tauri::AppHandle, key: String, to: web::Go) -> Result<(), String> {
    web::go(&app, &key, to)
}

#[tauri::command]
async fn browser_layer(app: tauri::AppHandle, layers: Vec<web::Layer>) -> Result<(), String> {
    web::layer(&app, layers)
}

#[tauri::command]
async fn browser_hide(app: tauri::AppHandle, key: String) -> Result<(), String> {
    web::hide(&app, &key)
}

#[tauri::command]
async fn browser_close(
    app: tauri::AppHandle,
    pages: State<'_, web::Pages>,
    key: String,
) -> Result<(), String> {
    web::close(&app, &pages, &key)
}

#[tauri::command]
async fn browser_close_all(
    app: tauri::AppHandle,
    pages: State<'_, web::Pages>,
) -> Result<(), String> {
    web::close_all(&app, &pages)
}

#[derive(Serialize)]
struct ScreenWindow {
    label: String,
    /// もう開いていたか。開いていたものは前に出す。
    existed: bool,
}

/// プラグインの画面だけを出す別のウィンドウを開く。同じ画面のものがあれば、それを使う。
#[tauri::command]
async fn open_screen_window(
    app: tauri::AppHandle,
    plugin: String,
    screen: String,
    title: String,
    width: f64,
    height: f64,
) -> Result<ScreenWindow, String> {
    let key = thumb::fnv(&[plugin.as_bytes(), b"\0", screen.as_bytes()]);
    let label = format!("{}{key:016x}", web::SCREEN);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(ScreenWindow {
            label,
            existed: true,
        });
    }
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(width.clamp(240.0, 4096.0), height.clamp(200.0, 4096.0))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(ScreenWindow {
        label,
        existed: false,
    })
}

/// プラグイン 1 つが右クリックメニューに足すもの。elevated が受け持つときは、items は空で画面が作る。
#[derive(Serialize)]
struct MenuGroup {
    plugin: String,
    items: Vec<MenuEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elevated: Option<Elevated>,
}

#[derive(Serialize)]
struct RunMenuOut {
    #[serde(flatten)]
    done: MenuDone,
    #[serde(skip_serializing_if = "Option::is_none")]
    elevated: Option<Elevated>,
}

/// 項目を作れなかったプラグインは、ほかのプラグインの項目を出せるよう、記録して飛ばす。
#[tauri::command]
async fn item_menu(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    ids: Vec<String>,
) -> Result<Vec<MenuGroup>, String> {
    let ts = targets(&cur, &ids)?;
    let mut out = Vec::new();
    for side in menu_sides(&ts) {
        let (items, elevated) = match side.ui {
            Some(ui) => (Vec::new(), Some(elevated_of(ui, &ts))),
            None => match run_menu_of(&app, &cur, &ts, |r, files| r.menu(&side.plugin, files)) {
                Ok(items) if items.is_empty() => continue,
                Ok(items) => (entries_of(items), None),
                Err(e) => {
                    log::warn!("右クリックメニューの項目を作れない（{}）: {e}", side.plugin);
                    continue;
                }
            },
        };
        out.push(MenuGroup {
            plugin: side.plugin,
            items,
            elevated,
        });
    }
    Ok(out)
}

#[tauri::command]
async fn run_item_menu(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    ids: Vec<String>,
    plugin: String,
    entry: String,
) -> Result<RunMenuOut, String> {
    let ts = targets(&cur, &ids)?;
    let side = menu_sides(&ts)
        .into_iter()
        .find(|s| s.plugin == plugin)
        .ok_or("メニューに対応するプラグインがありません")?;
    match side.ui {
        Some(ui) => Ok(RunMenuOut {
            done: MenuDone::default(),
            elevated: Some(elevated_of(ui, &ts)),
        }),
        None => {
            let run = run_menu_of(&app, &cur, &ts, |r, files| {
                r.run_menu(&plugin, files, &entry)
            })?;
            Ok(RunMenuOut {
                done: finish_menu(&app, &cur, &ts, run)?,
                elevated: None,
            })
        }
    }
}

/// elevated の中から呼ぶ sandbox の thumbnail。頭の 8 バイトに素材の幅と高さ（わからなければ 0）、続けて PNG。
/// 作らなければ空。
#[tauri::command]
async fn sandbox_thumbnail(
    cur: State<'_, Current>,
    id: String,
    edge: u32,
) -> Result<tauri::ipc::Response, String> {
    let t = Target::of(&cur, &id)?;
    let Some((png, size, reads)) = t.run(|r, ext, path| r.thumbnail(ext, path, edge))? else {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    };
    if let Some(s) = cur.lock().as_mut()
        && Arc::ptr_eq(&s.plugins, &t.plugins)
    {
        s.ui_reads.entry(id).or_default().extend(reads);
    }
    let (w, h) = size.unwrap_or_default();
    let mut out = Vec::with_capacity(8 + png.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&png);
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
async fn content_sandbox(job: u64) -> Result<Vec<content::SandboxPart>, String> {
    tauri::async_runtime::spawn_blocking(move || content::sandbox(job))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn put_content(request: tauri::ipc::Request<'_>) -> Result<(), String> {
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

#[tauri::command]
async fn sandbox_details(cur: State<'_, Current>, id: String) -> Result<Vec<Detail>, String> {
    let t = Target::of(&cur, &id)?;
    Ok(rows_of(t.run(|r, ext, path| r.details(ext, path))?))
}

#[tauri::command]
async fn sandbox_menu(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    ids: Vec<String>,
    plugin: String,
) -> Result<Vec<MenuEntry>, String> {
    let ts = targets(&cur, &ids)?;
    Ok(entries_of(run_menu_of(&app, &cur, &ts, |r, files| {
        r.menu(&plugin, files)
    })?))
}

#[tauri::command]
async fn sandbox_run_menu(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    ids: Vec<String>,
    plugin: String,
    entry: String,
) -> Result<MenuDone, String> {
    let ts = targets(&cur, &ids)?;
    let run = run_menu_of(&app, &cur, &ts, |r, files| {
        r.run_menu(&plugin, files, &entry)
    })?;
    finish_menu(&app, &cur, &ts, run)
}

#[tauri::command]
async fn plugin_read(
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
async fn plugin_call(
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

#[tauri::command]
async fn plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
) -> Result<Option<String>, String> {
    with_session(&cur, |s| s.plugins.data_of(&plugin, &key))
}

#[tauri::command]
async fn set_plugin_data(
    cur: State<'_, Current>,
    plugin: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    with_session(&cur, |s| s.plugins.set_data_of(&plugin, &key, value))
}

#[tauri::command]
async fn plugin_settings(
    cur: State<'_, Current>,
    plugin: String,
) -> Result<serde_json::Map<String, Value>, String> {
    with_session(&cur, |s| {
        s.plugins
            .settings_of(&plugin)
            .ok_or_else(|| format!("{plugin} は有効になっていません"))
    })
}

#[tauri::command]
async fn put_thumbnail(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("リクエスト本文が PNG ではありません".into());
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let id = head("id").ok_or("ID が指定されていません")?.to_owned();
    let num = |k: &str| head(k).and_then(|v| v.parse::<u32>().ok());
    let original = num("width").zip(num("height"));
    let keys: Vec<String> = head("settings")
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| format!("settings の読み込みに失敗しました：{e}"))?
        .unwrap_or_default();
    let (src, out, cache, reads) = with_session(&cur, |s| {
        let mut reads = s.ui_reads.remove(&id).unwrap_or_default();
        let (path, ext) = s.lib.asset(&id)?;
        if s.plugins.handles(&ext, Part::Thumbnail) != Some(By::Elevated) {
            return Err(format!(
                "「.{ext}」のサムネイルは UI ファイルで生成する設定になっていません"
            ));
        }
        // 値は、WASM が読んだものと同じ形にそろえるため、こちらで引く
        for k in keys {
            let v = s.plugins.thumb_setting(&ext, &k);
            reads.insert(k, v);
        }
        let out = thumb::path_for(&s.thumbs, &id, path, &reads)
            .ok_or_else(|| format!("{} の読み込みに失敗しました", path.display()))?;
        Ok((path.to_owned(), out, s.lib.cache(), reads))
    })?;
    let size = thumb::place(png, original, &out).map_err(|e| format!("{}: {e}", src.display()))?;
    tell_thumb(&app, &cache, &id, &src, &out, size, &reads);
    Ok(())
}

#[tauri::command]
async fn missing_waveforms(
    cur: State<'_, Current>,
    ids: Vec<String>,
) -> Result<Vec<String>, String> {
    with_session(&cur, |s| {
        Ok(ids
            .into_iter()
            .filter(|id| {
                s.lib.asset(id).is_ok_and(|(path, ext)| {
                    s.plugins.ui_of(&ext, Part::Waveform).is_some()
                        && thumb::wave_path(&s.thumbs, id, path).is_some_and(|p| !p.exists())
                })
            })
            .collect())
    })
}

#[tauri::command]
async fn waveform(cur: State<'_, Current>, id: String) -> Result<tauri::ipc::Response, String> {
    let path = with_session(&cur, |s| {
        let (path, _) = s.lib.asset(&id)?;
        Ok(thumb::wave_path(&s.thumbs, &id, path))
    })?;
    let bytes = path.and_then(|p| std::fs::read(p).ok()).unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn put_waveform(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(wave) = request.body() else {
        return Err("リクエスト本文が波形のデータではありません".into());
    };
    if wave.is_empty() || wave.len() > 1 << 16 {
        return Err(format!("波形のデータの長さ（{}）が不正です", wave.len()));
    }
    let id = request
        .headers()
        .get("id")
        .and_then(|v| v.to_str().ok())
        .ok_or("ID が指定されていません")?
        .to_owned();
    let (src, ext, thumbs, plugins, cache) = with_session(&cur, |s| {
        let (path, ext) = s.lib.asset(&id)?;
        if s.plugins.ui_of(&ext, Part::Waveform).is_none() {
            return Err(format!("「.{ext}」の波形を作成するプラグインがありません"));
        }
        Ok((
            path.to_owned(),
            ext,
            s.thumbs.clone(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
        ))
    })?;
    let err = || format!("{} の読み込みに失敗しました", src.display());
    thumb::keep(&thumb::wave_path(&thumbs, &id, &src).ok_or_else(err)?, wave);
    if thumb::is_making(&src) {
        return Ok(());
    }
    wave_thumb(&app, &cache, &plugins, &thumbs, &id, &src, &ext)
}

fn plugin_file(
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

#[tauri::command]
async fn choose_library(app: tauri::AppHandle) -> Result<bool, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("ライブラリのフォルダを選択")
        .blocking_pick_folder()
    else {
        return Ok(false);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err(format!("{} はフォルダではありません", dir.display()));
    }
    settings::set_library(&app, &dir)?;
    Ok(true)
}

#[derive(Serialize)]
struct KnownLibrary {
    path: PathBuf,
    name: String,
    opened: f64,
    exists: bool,
    current: bool,
}

#[tauri::command]
async fn libraries(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<Vec<KnownLibrary>, String> {
    let current = root_of(&cur).ok();
    Ok(settings::recent(&app)?
        .into_iter()
        .map(|r| KnownLibrary {
            name: r.path.file_name().map_or_else(
                || r.path.to_string_lossy().into_owned(),
                |n| n.to_string_lossy().into_owned(),
            ),
            exists: r.path.is_dir(),
            current: current.as_deref() == Some(r.path.as_path()),
            opened: r.opened,
            path: r.path,
        })
        .collect())
}

#[tauri::command]
async fn switch_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{} が見つかりません", path.display()));
    }
    settings::set_library(&app, &path)
}

#[tauri::command]
async fn forget_library(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    settings::forget(&app, &path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoTag {
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
async fn auto_tag(app: tauri::AppHandle) -> Result<AutoTag, String> {
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
async fn set_auto_tag(app: tauri::AppHandle, on: bool) -> Result<(), String> {
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
                s.lib.snapshot().items,
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
fn cancel_auto_tag_download() {
    embed::install::cancel();
}

#[tauri::command]
async fn set_tag_suggest(app: tauri::AppHandle, mode: settings::TagSuggest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        settings::set_tag_suggest(&app, mode)?;
        refresh_suggestions(&app, false);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_content_search(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    settings::set_content_search(&app, on)
}

/// 内容での検索に入ったときに呼ぶ。llama-server が起動し終えるまで待つ。
#[tauri::command]
async fn prepare_content_search(app: tauri::AppHandle) -> Result<(), String> {
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
async fn search_content(
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
fn refresh_suggestions(app: &tauri::AppHandle, all: bool) {
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
                    match s.lib.stored(&id) {
                        Some(it) => items.push(it),
                        None => removed.push(id),
                    }
                }
                suggest::Source::Changed { items, removed }
            }
            None => suggest::Source::All(s.lib.snapshot().items),
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
async fn record_tags(
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
async fn undo_tags(app: tauri::AppHandle, item: String) -> Result<(), String> {
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
async fn suggest_tags(id: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || suggest::suggest_tags(&id))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cache_usage(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<tidy::Usage, String> {
    Ok(tidy::usage(&cache_dir(&app)?, &root_of(&cur)?))
}

#[tauri::command]
async fn clear_cache(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    kind: tidy::Kind,
) -> Result<(), String> {
    let root = root_of(&cur)?;
    let unused = match kind {
        tidy::Kind::All => unused_plugins_of(&app, &cur)?,
        _ => Vec::new(),
    };
    close_for_clearing(&app, &cur)?;
    tidy::clear(&cache_dir(&app)?, &root, kind)?;
    remove_plugins(unused)
}

fn unused_plugins_of(
    app: &tauri::AppHandle,
    cur: &State<Current>,
) -> Result<Vec<(tidy::Unused, PathBuf)>, String> {
    let mut used: HashSet<String> = HashSet::new();
    if let Some(ids) = root_of(cur).ok().and_then(|r| plugin_ids(&r)) {
        used.extend(ids);
    }
    for r in settings::recent(app)? {
        used.extend(plugin_ids(&r.path).unwrap_or(r.plugins));
    }
    Ok(tidy::unused(&plugin_dir(app)?, &used))
}

#[tauri::command]
async fn unused_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<Vec<tidy::Unused>, String> {
    Ok(unused_plugins_of(&app, &cur)?
        .into_iter()
        .map(|(u, _)| u)
        .collect())
}

#[tauri::command]
async fn remove_unused_plugins(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
) -> Result<(), String> {
    remove_plugins(unused_plugins_of(&app, &cur)?)
}

fn remove_plugins(plugins: Vec<(tidy::Unused, PathBuf)>) -> Result<(), String> {
    for (u, path) in plugins {
        std::fs::remove_dir_all(&path).map_err(|e| format!("{}: {e}", u.name))?;
    }
    Ok(())
}

#[tauri::command]
async fn save_item(
    cur: State<'_, Current>,
    id: String,
    patch: ItemPatch,
) -> Result<Option<StoredItem>, String> {
    with(&cur, |l| l.save_item(&id, &patch))
}

#[tauri::command]
async fn move_item(
    cur: State<'_, Current>,
    id: String,
    place: Place,
) -> Result<StoredItem, String> {
    with(&cur, |l| l.move_item(&id, &place))
}

#[tauri::command]
async fn rename_item(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    name: String,
) -> Result<StoredItem, String> {
    let (it, renamed) = with(&cur, |l| {
        let old = l.stored(&id).map(|it| it.name).unwrap_or_default();
        let it = l.rename_item(&id, &name)?;
        Ok((it, l.sync_link_names(&HashMap::from([(id.clone(), old)]))))
    })?;
    if !renamed.is_empty() {
        let changes = library::Changes {
            items: renamed,
            ..library::Changes::default()
        };
        let _ = app.emit("library-changed", &changes);
    }
    Ok(it)
}

#[tauri::command]
async fn delete_item(cur: State<'_, Current>, id: String) -> Result<(), String> {
    with(&cur, |l| l.delete_item(&id))
}

#[tauri::command]
async fn save_state(cur: State<'_, Current>, state: LibraryState) -> Result<(), String> {
    with(&cur, |l| l.save_state(&state))
}

#[tauri::command]
async fn tag_history(cur: State<'_, Current>) -> Result<Vec<String>, String> {
    with(&cur, |l| l.tag_history())
}

#[tauri::command]
async fn save_tag_history(cur: State<'_, Current>, tags: Vec<String>) -> Result<(), String> {
    with(&cur, |l| l.save_tag_history(&tags))
}

#[tauri::command]
async fn open_history(cur: State<'_, Current>) -> Result<Vec<String>, String> {
    with(&cur, |l| l.open_history())
}

#[tauri::command]
async fn save_open_history(cur: State<'_, Current>, ids: Vec<String>) -> Result<(), String> {
    with(&cur, |l| l.save_open_history(&ids))
}

#[tauri::command]
async fn tabs(cur: State<'_, Current>) -> Result<Option<serde_json::Map<String, Value>>, String> {
    with(&cur, |l| l.tabs())
}

#[tauri::command]
async fn save_tabs(
    cur: State<'_, Current>,
    tabs: serde_json::Map<String, Value>,
) -> Result<(), String> {
    with(&cur, |l| l.save_tabs(&tabs))
}

#[tauri::command]
async fn create_note(
    cur: State<'_, Current>,
    name: String,
    place: Place,
) -> Result<StoredItem, String> {
    with(&cur, |l| l.create_note(&name, &place))
}

#[tauri::command]
async fn create_project(cur: State<'_, Current>, name: String) -> Result<StoredProject, String> {
    with(&cur, |l| l.create_project(&name))
}

#[tauri::command]
async fn save_project(
    cur: State<'_, Current>,
    name: String,
    cover: serde_json::Value,
) -> Result<(), String> {
    with(&cur, |l| l.save_project(&name, cover))
}

#[tauri::command]
async fn save_tag_cover(
    cur: State<'_, Current>,
    tag: String,
    cover: serde_json::Value,
) -> Result<(), String> {
    with(&cur, |l| l.save_tag_cover(&tag, cover))
}

#[tauri::command]
async fn rename_tag(
    cur: State<'_, Current>,
    from: String,
    to: String,
    keep_from: bool,
) -> Result<(), String> {
    with(&cur, |l| l.rename_tag(&from, &to, keep_from))
}

#[tauri::command]
async fn delete_tag_cover(cur: State<'_, Current>, tag: String) -> Result<(), String> {
    with(&cur, |l| l.delete_tag_cover(&tag))
}

/// ファイルを動かしたあとで、ライブラリを突き合わせ直して画面に知らせる。
fn recheck(app: &tauri::AppHandle) -> Result<(), String> {
    let cur = app.state::<Current>();
    let (id, root, plugins, cache, thumbs) = with_session(&cur, |s| {
        Ok((
            s.id,
            s.lib.root().to_owned(),
            Arc::clone(&s.plugins),
            s.lib.cache(),
            s.thumbs.clone(),
        ))
    })?;
    let app = app.clone();
    CHECKING.fetch_add(1, Ordering::Relaxed);
    background::spawn(move || {
        check(&app, id, &root, &plugins, &cache, &thumbs);
        CHECKING.fetch_sub(1, Ordering::Relaxed);
    });
    Ok(())
}

#[tauri::command]
async fn rename_project(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    from: String,
    to: String,
) -> Result<(), String> {
    with(&cur, |l| l.rename_project(&from, &to))?;
    recheck(&app)
}

#[tauri::command]
async fn delete_project(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    name: String,
) -> Result<(), String> {
    let r = with(&cur, |l| l.delete_project(&name));
    recheck(&app)?;
    r
}

#[tauri::command]
async fn relink_meta(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    meta: PathBuf,
    to: String,
) -> Result<(), String> {
    with(&cur, |l| l.relink_meta(&meta, &to))?;
    recheck(&app)
}

#[tauri::command]
async fn discard_meta(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    meta: PathBuf,
) -> Result<(), String> {
    with(&cur, |l| l.discard_meta(&meta))?;
    recheck(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let commands: Box<dyn Fn(tauri::ipc::Invoke) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            open_library,
            choose_library,
            inspect_drop,
            import_files,
            save_item,
            move_item,
            save_state,
            tag_history,
            save_tag_history,
            open_history,
            save_open_history,
            tabs,
            save_tabs,
            create_note,
            create_project,
            save_project,
            save_tag_cover,
            rename_tag,
            delete_tag_cover,
            rename_project,
            delete_project,
            relink_meta,
            discard_meta,
            plugins,
            install_plugin,
            update_plugin,
            remove_plugin,
            pick_plugin,
            set_plugin_enabled,
            developer,
            set_developer,
            app_settings,
            set_app_settings,
            pick_command,
            pick_dev_path,
            reload_plugins,
            plugin_work,
            stop_plugin_work,
            seen_thumbs,
            hook_work,
            stop_hooks,
            export_data,
            checking,
            set_plugin_setting,
            item_view,
            item_details,
            rename_item,
            item_decoded,
            reveal_item,
            open_item_default,
            item_path,
            item_menu,
            run_item_menu,
            sandbox_thumbnail,
            sandbox_details,
            sandbox_menu,
            sandbox_run_menu,
            content_sandbox,
            put_content,
            delete_item,
            plugin_read,
            plugin_call,
            plugin_settings,
            plugin_data,
            set_plugin_data,
            put_thumbnail,
            import_data,
            missing_waveforms,
            put_waveform,
            waveform,
            libraries,
            switch_library,
            forget_library,
            auto_tag,
            set_auto_tag,
            cancel_auto_tag_download,
            set_tag_suggest,
            set_content_search,
            prepare_content_search,
            search_content,
            record_tags,
            undo_tags,
            suggest_tags,
            cache_usage,
            clear_cache,
            unused_plugins,
            remove_unused_plugins,
            open_url,
            plugin_fetch,
            browser_show,
            browser_go,
            browser_layer,
            browser_hide,
            browser_close,
            browser_close_all,
            open_screen_window
        ]);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Current::default())
        .manage(web::Pages::default())
        .register_uri_scheme_protocol("plugin", |ctx, req| {
            if !web::ours(ctx.webview_label()) {
                return plugin::files::serve("", None);
            }
            plugin_file(ctx.app_handle(), &req)
        })
        .invoke_handler(move |invoke| {
            if invoke.message.webview_ref().label() != web::MAIN {
                invoke.resolver.reject("外のページからは使えません");
                return true;
            }
            commands(invoke)
        })
        .on_window_event(|w, e| {
            // 画面のウィンドウは本体の窓とやり取りして動くので、本体の窓と一緒に閉じる
            if w.label() == web::MAIN && matches!(e, tauri::WindowEvent::Destroyed) {
                web::close_screens(w.app_handle());
            }
        })
        .setup(|app| {
            // 前に起動したときに広げた開発版は、もう使っていない
            if let Some(d) = dev_unpack_dir(app.handle()) {
                let _ = std::fs::remove_dir_all(d);
            }
            if let Ok(d) = cache_dir(app.handle()) {
                plugin::set_compiled_dir(d.join("wasm"));
            }
            if let Ok(d) = app.path().app_data_dir() {
                embed::init(&d);
            }
            if let Ok(s) = settings::app_settings(app.handle()) {
                apply_app_settings(&s);
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, e| {
            if let tauri::RunEvent::Exit = e {
                embed::shutdown();
            }
        });
}
