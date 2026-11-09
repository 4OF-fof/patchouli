use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use super::{Entry, Place};
use crate::plugin::{By, Part, Registry, Runner};
use crate::session::{Current, with_session};
use crate::thumb;

/// サムネイルのために取り出す大きさの上限。
const THUMB_SOURCE_MAX: u64 = 256 << 20;
/// サムネイルを待っている取り出し済みのファイルの数の上限。
const THUMB_QUEUE: usize = 4;

type Jobs = HashMap<u32, Arc<AtomicBool>>;

fn jobs() -> &'static Mutex<Jobs> {
    static J: OnceLock<Mutex<Jobs>> = OnceLock::new();
    J.get_or_init(Mutex::default)
}

fn job_flag(job: u32) -> Arc<AtomicBool> {
    let mut g = jobs().lock().unwrap_or_else(PoisonError::into_inner);
    Arc::clone(g.entry(job).or_default())
}

fn end_job(job: u32) {
    jobs()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&job);
}

struct Opened {
    place: Place,
    plugins: Arc<Registry>,
}

fn open(cur: &State<Current>, id: &str) -> Result<Opened, String> {
    with_session(cur, |s| {
        let (path, ext) = s.lib.asset(id)?;
        if s.plugins.handles(&ext, Part::Archive).is_none() {
            return Err(format!(
                "「.{ext}」の内容を読み取れるプラグインがありません"
            ));
        }
        Ok(Opened {
            place: Place::new(&s.archives, id, path, &ext)?,
            plugins: Arc::clone(&s.plugins),
        })
    })
}

fn runner_of(plugins: &Arc<Registry>, stop: Arc<AtomicBool>) -> Runner {
    let mut r = Runner::new(Arc::clone(plugins));
    r.set_stop(stop);
    r
}

/// 止められる長い処理を、ほかの操作を止めないように動かす。
async fn working<T: Send + 'static>(
    job: u32,
    f: impl FnOnce(Arc<AtomicBool>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let stop = job_flag(job);
    let r = tauri::async_runtime::spawn_blocking(move || f(stop)).await;
    end_job(job);
    r.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn archive_entries(
    cur: State<'_, Current>,
    id: String,
    job: u32,
) -> Result<Vec<Entry>, String> {
    let o = open(&cur, &id)?;
    working(job, move |stop| {
        o.place.entries(&mut runner_of(&o.plugins, stop))
    })
    .await
}

#[derive(Serialize)]
pub(crate) struct Extracted {
    id: String,
    file: PathBuf,
}

/// path を取り出し、中のファイルの ID で読めるようにする。
#[tauri::command]
pub(crate) async fn archive_extract(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    path: String,
    job: u32,
) -> Result<Extracted, String> {
    let o = open(&cur, &id)?;
    let inner = format!("{id}!{path}");
    let file = working(job, move |stop| {
        let mut runner = runner_of(&o.plugins, stop);
        let entries = o.place.entries(&mut runner)?;
        let entry = entries
            .iter()
            .find(|e| e.path == path)
            .ok_or_else(|| format!("「{path}」がアーカイブの中に見つかりません"))?;
        o.place.extract(&mut runner, entry, job)
    })
    .await?;
    let cur = app.state::<Current>();
    with_session(&cur, |s| {
        s.lib.set_extracted(inner.clone(), file.clone());
        Ok(())
    })?;
    Ok(Extracted { id: inner, file })
}

#[derive(Clone, Serialize)]
struct ThumbReady<'a> {
    job: u32,
    path: &'a str,
    file: &'a Path,
    width: u32,
    height: u32,
}

fn tell(app: &tauri::AppHandle, job: u32, path: &str, file: &Path, (width, height): (u32, u32)) {
    let _ = app.emit(
        "archive-thumbnail",
        ThumbReady {
            job,
            path,
            file,
            width,
            height,
        },
    );
}

fn make_thumb(
    runner: &mut Runner,
    e: &Entry,
    src: &Path,
    out: &Path,
    none: &Path,
) -> Option<(u32, u32)> {
    let edge = thumb::edge();
    let made = match runner.thumbnail(&e.ext(), src, edge) {
        Ok(Some((png, original, _))) => match thumb::place(&png, original, out) {
            Ok(size) => Some(size),
            Err(err) => {
                log::warn!("{}: {err}", e.path);
                None
            }
        },
        Ok(None) => None,
        Err(err) => {
            log::warn!("{}: {err}", e.path);
            None
        }
    };
    if made.is_none() {
        let _ = fs::write(none, []);
    }
    made
}

/// paths のサムネイルを作り、できたものから archive-thumbnail で知らせる。
#[tauri::command]
pub(crate) async fn archive_thumbs(
    app: tauri::AppHandle,
    cur: State<'_, Current>,
    id: String,
    paths: Vec<String>,
    job: u32,
) -> Result<(), String> {
    let o = open(&cur, &id)?;
    working(job, move |stop| {
        let mut runner = runner_of(&o.plugins, Arc::clone(&stop));
        let entries = o.place.entries(&mut runner)?;
        let by_path: HashMap<&str, &Entry> = entries.iter().map(|e| (e.path.as_str(), e)).collect();
        let edge = thumb::edge();
        let mut missing = Vec::new();
        for path in &paths {
            let Some(&e) = by_path.get(path.as_str()) else {
                continue;
            };
            if e.encrypted
                || e.size == 0
                || e.size > THUMB_SOURCE_MAX
                || o.plugins.handles(&e.ext(), Part::Thumbnail) != Some(By::Wasm)
            {
                continue;
            }
            let (png, none) = o.place.thumb_paths(e, edge);
            if let Ok(size) = imagesize::size(&png) {
                tell(
                    &app,
                    job,
                    path,
                    &png,
                    (size.width as u32, size.height as u32),
                );
            } else if !none.exists() {
                missing.push(e);
            }
        }
        if missing.is_empty() {
            return Ok(());
        }
        let outputs = o.place.thumb_outputs(&missing, job)?;
        let targets: Vec<(Entry, PathBuf)> = missing
            .iter()
            .zip(&outputs)
            .map(|(&e, out)| (e.clone(), out.file.clone()))
            .collect();
        let (finished, ready) = sync_channel::<usize>(THUMB_QUEUE);
        let maker = {
            let (app, plugins, place) = (app.clone(), Arc::clone(&o.plugins), o.place.clone());
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                let mut runner = runner_of(&plugins, stop);
                for i in ready {
                    let Some((e, file)) = targets.get(i) else {
                        continue;
                    };
                    let (png, none) = place.thumb_paths(e, edge);
                    if let Some(parent) = png.parent()
                        && let Err(err) = fs::create_dir_all(parent)
                    {
                        log::warn!("{}: {err}", parent.display());
                    }
                    if let Some(size) = make_thumb(&mut runner, e, file, &png, &none) {
                        tell(&app, job, &e.path, &png, size);
                    }
                    let _ = fs::remove_file(file);
                }
            })
        };
        let r = runner.archive_extract(&o.place.ext, &o.place.src, &outputs, Some(finished));
        let _ = maker.join();
        o.place.end_work(job);
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        r
    })
    .await
}

#[tauri::command]
pub(crate) fn archive_stop(job: u32) {
    job_flag(job).store(true, Ordering::Relaxed);
}
