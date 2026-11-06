use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, State};

use crate::background;
use crate::library::StoredItem;
use crate::library::cache::Cache;
use crate::plugin::ipc::Target;
use crate::plugin::{By, Part, Reads, Registry};
use crate::session::{Current, with_session};
use crate::thumb;

pub(crate) fn reads_now(plugins: &Registry, before: Option<&Reads>, ext: &str) -> Reads {
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

pub(crate) fn plan_thumbs<'a>(
    plugins: &Registry,
    thumbs: &Path,
    cache: &Cache,
    items: impl IntoIterator<Item = &'a mut StoredItem>,
) -> (Vec<thumb::Job>, Vec<PathBuf>, bool) {
    let reads = match cache.thumb_reads() {
        Ok(reads) => reads,
        // 前に読んだ値が分からないと場所を決められないので、写しにある場所のまま、作りも片付けもしない
        Err(e) => {
            log::warn!("{e}");
            return (Vec::new(), Vec::new(), false);
        }
    };
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
        let waves = plugins.waves(&it.ext);
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
pub(crate) fn make_thumbs(
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

pub(crate) fn wave_thumb(
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
    let reads = reads_now(plugins, cache.thumb_read(src)?.as_ref(), ext);
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

pub(crate) fn tell_thumb(
    app: &tauri::AppHandle,
    cache: &Cache,
    id: &str,
    src: &Path,
    file: &Path,
    (width, height): (u32, u32),
    reads: &Reads,
) {
    if let Err(e) = cache.set_thumb(src, file, (width, height), reads) {
        log::warn!("{e}");
    }
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

#[tauri::command]
pub(crate) fn seen_thumbs(ids: Vec<String>) {
    thumb::set_seen(ids);
}

pub(crate) fn spawn_thumbs(
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

#[derive(Clone, Serialize)]
struct ThumbReady<'a> {
    id: &'a str,
    file: &'a Path,
    width: u32,
    height: u32,
    wave: bool,
}

/// elevated の中から呼ぶ sandbox の thumbnail。頭の 8 バイトに素材の幅と高さ（わからなければ 0）、続けて PNG。
/// 作らなければ空。
#[tauri::command]
pub(crate) async fn sandbox_thumbnail(
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
pub(crate) async fn put_thumbnail(
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
pub(crate) async fn missing_waveforms(
    cur: State<'_, Current>,
    ids: Vec<String>,
) -> Result<Vec<String>, String> {
    with_session(&cur, |s| {
        Ok(ids
            .into_iter()
            .filter(|id| {
                s.lib.asset(id).is_ok_and(|(path, ext)| {
                    s.plugins.waves(&ext)
                        && thumb::wave_path(&s.thumbs, id, path).is_some_and(|p| !p.exists())
                })
            })
            .collect())
    })
}

#[tauri::command]
pub(crate) async fn waveform(
    cur: State<'_, Current>,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let path = with_session(&cur, |s| {
        let (path, _) = s.lib.asset(&id)?;
        Ok(thumb::wave_path(&s.thumbs, &id, path))
    })?;
    let bytes = path.and_then(|p| std::fs::read(p).ok()).unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub(crate) async fn put_waveform(
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
        if !s.plugins.waves(&ext) {
            return Err(format!("「.{ext}」は波形を作れる形式ではありません"));
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
