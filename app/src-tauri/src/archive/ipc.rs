use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{RecvTimeoutError, Sender, channel, sync_channel};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use super::{Entry, Place, Shown, ThumbFiles, is_executable};
use crate::plugin::{By, Part, Registry, Runner};
use crate::session::{Current, with, with_session};
use crate::thumb;

/// サムネイルのために取り出す大きさの上限。
const THUMB_SOURCE_MAX: u64 = 256 << 20;
/// サムネイルを待っている取り出し済みのファイルの数の上限。
const THUMB_QUEUE: usize = 4;
/// キューに加えて、処理中と書き込み中の 1 件ずつが同時に置かれる。
const THUMB_HELD: usize = THUMB_QUEUE + 2;
/// 画面が応答しなくなったときに、取り出しを止めないようにする。
const SOURCE_WAIT: Duration = Duration::from_secs(600);

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

/// 画面に渡している途中のファイル。ジョブごとに 1 件まで。
struct Handing {
    at: ThumbFiles,
    ratio: f64,
    done: Sender<()>,
}

fn handing() -> std::sync::MutexGuard<'static, HashMap<u32, Handing>> {
    static H: OnceLock<Mutex<HashMap<u32, Handing>>> = OnceLock::new();
    H.get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
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

#[derive(Serialize)]
pub(crate) struct Listed {
    #[serde(flatten)]
    entry: Entry,
    executable: bool,
}

#[tauri::command]
pub(crate) async fn archive_entries(
    cur: State<'_, Current>,
    id: String,
    job: u32,
) -> Result<Vec<Listed>, String> {
    let o = open(&cur, &id)?;
    let list = working(job, move |stop| {
        o.place.entries(&mut runner_of(&o.plugins, stop))
    })
    .await?;
    Ok(list
        .into_iter()
        .map(|entry| Listed {
            executable: is_executable(&entry.ext()),
            entry,
        })
        .collect())
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

/// 取り出し済みのファイルを文字列として読む。
#[tauri::command]
pub(crate) async fn archive_text(
    cur: State<'_, Current>,
    id: String,
    path: String,
) -> Result<String, String> {
    let file = with(&cur, |l| Ok(l.path(&format!("{id}!{path}"))?.to_owned()))?;
    let bytes = fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub(crate) async fn archive_waveform(
    cur: State<'_, Current>,
    id: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let place = open(&cur, &id)?.place;
    Ok(tauri::ipc::Response::new(
        fs::read(place.wave_path(&path)).unwrap_or_default(),
    ))
}

#[derive(Clone, Serialize)]
struct ThumbNews<'a> {
    job: u32,
    path: &'a str,
    /// null なら、サムネイルを生成できなかった。
    file: Option<&'a Path>,
    width: u32,
    height: u32,
    wave: bool,
}

fn tell(app: &tauri::AppHandle, job: u32, path: &str, shown: Option<&Shown>) {
    let (width, height) = shown.map_or((0, 0), |s| s.size);
    let _ = app.emit(
        "archive-thumbnail",
        ThumbNews {
            job,
            path,
            file: shown.map(|s| s.file.as_path()),
            width,
            height,
            wave: shown.is_some_and(|s| s.wave),
        },
    );
}

/// 一時的な失敗は記録せず、次に表示したときにやり直す。
fn make_thumb(runner: &mut Runner, e: &Entry, src: &Path, at: &ThumbFiles) -> bool {
    match runner.thumbnail(&e.ext(), src, thumb::edge()) {
        Ok(Some((png, original, _))) => thumb::place(&png, original, &at.png)
            .inspect_err(|err| log::warn!("{}: {err}", e.path))
            .is_ok(),
        Ok(None) => {
            let _ = fs::write(&at.none, []);
            false
        }
        Err(err) => {
            log::warn!("{}: {err}", e.path);
            false
        }
    }
}

/// プラグインが作ったもの（音声ならジャケット）があれば描かない。
fn draw_wave_thumb(at: &ThumbFiles, wave: &[u8], ratio: f64) -> Result<(), String> {
    if at.png.exists() || at.drawn.exists() {
        return Ok(());
    }
    thumb::keep(&at.drawn, &thumb::draw_wave(wave, ratio)?);
    Ok(())
}

#[derive(Clone, Copy)]
struct Needs {
    wasm: bool,
    script: bool,
    wave: bool,
}

impl Needs {
    fn by_screen(self) -> bool {
        self.script || self.wave
    }
}

struct Target {
    entry: Entry,
    file: PathBuf,
    needs: Needs,
    at: ThumbFiles,
}

#[derive(Clone, Serialize)]
struct SourceReady<'a> {
    job: u32,
    id: &'a str,
    name: &'a str,
    ext: &'a str,
    file: &'a Path,
    wave: bool,
    script: bool,
}

/// 波形やスクリプトのサムネイルを画面に作らせ、終わるまで待つ。待っている間は次のファイルの取り出しも止まる。
fn hand_over(app: &tauri::AppHandle, job: u32, archive: &str, t: &Target, stop: &AtomicBool) {
    let id = format!("{archive}!{}!{job}", t.entry.path);
    let cur = app.state::<Current>();
    let Ok(ratio) = with_session(&cur, |s| {
        s.lib.set_extracted(id.clone(), t.file.clone());
        Ok(s.plugins.ratio_of(&t.entry.ext()))
    }) else {
        return;
    };
    let (done, wait) = channel();
    handing().insert(
        job,
        Handing {
            at: t.at.clone(),
            ratio,
            done,
        },
    );
    let name = t.entry.name();
    let _ = app.emit(
        "archive-source",
        SourceReady {
            job,
            id: &id,
            name: name.rsplit_once('.').map_or(name, |(stem, _)| stem),
            ext: &t.entry.ext(),
            file: &t.file,
            wave: t.needs.wave,
            script: t.needs.script,
        },
    );
    let until = Instant::now() + SOURCE_WAIT;
    while !stop.load(Ordering::Relaxed) && Instant::now() < until {
        match wait.recv_timeout(Duration::from_millis(200)) {
            Err(RecvTimeoutError::Timeout) => {}
            _ => break,
        }
    }
    handing().remove(&job);
    let _ = with_session(&cur, |s| {
        s.lib.forget_extracted(&id);
        s.ui_reads.remove(&id);
        Ok(())
    });
}

/// paths のサムネイルと波形を作り、できたものから archive-thumbnail で知らせる。
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
        let mut missing: Vec<(&Entry, Needs, ThumbFiles)> = Vec::new();
        for path in &paths {
            let Some(&e) = by_path.get(path.as_str()) else {
                continue;
            };
            let ext = e.ext();
            let by = o.plugins.handles(&ext, Part::Thumbnail);
            let waves = o.plugins.waves(&ext);
            if e.encrypted || (by.is_none() && !waves) {
                continue;
            }
            if e.size == 0 || e.size > THUMB_SOURCE_MAX {
                tell(&app, job, path, None);
                continue;
            }
            let owner = o.plugins.thumb_version(&ext).unwrap_or_default();
            let at = o.place.thumb_files(e, edge, &owner);
            let tried = at.png.exists() || at.none.exists();
            let needs = Needs {
                wasm: by == Some(By::Wasm) && !tried,
                script: by == Some(By::Script) && !tried,
                wave: waves && !at.wave.exists(),
            };
            if !needs.wasm && !needs.by_screen() {
                if waves
                    && at.shown().is_none()
                    && let Ok(wave) = fs::read(&at.wave)
                    && let Err(err) = draw_wave_thumb(&at, &wave, o.plugins.ratio_of(&ext))
                {
                    log::warn!("{}: {err}", e.path);
                }
                tell(&app, job, path, at.shown().as_ref());
                continue;
            }
            if let Some(shown) = at.shown() {
                tell(&app, job, path, Some(&shown));
            }
            missing.push((e, needs, at));
        }
        if missing.is_empty() {
            return Ok(());
        }
        let files: Vec<&Entry> = missing.iter().map(|m| m.0).collect();
        let outputs = o.place.thumb_outputs(&files, THUMB_HELD, job)?;
        let targets: Vec<Target> = missing
            .into_iter()
            .zip(&outputs)
            .map(|((e, needs, at), out)| Target {
                entry: e.clone(),
                file: out.file.clone(),
                needs,
                at,
            })
            .collect();
        let (finished, ready) = sync_channel::<usize>(THUMB_QUEUE);
        let maker = {
            let (app, plugins, id) = (app.clone(), Arc::clone(&o.plugins), id.clone());
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                let mut runner = runner_of(&plugins, Arc::clone(&stop));
                for i in ready {
                    let Some(t) = targets.get(i) else {
                        continue;
                    };
                    if !stop.load(Ordering::Relaxed) {
                        if let Some(parent) = t.at.png.parent()
                            && let Err(err) = fs::create_dir_all(parent)
                        {
                            log::warn!("{}: {err}", parent.display());
                        }
                        if t.needs.wasm && make_thumb(&mut runner, &t.entry, &t.file, &t.at) {
                            tell(&app, job, &t.entry.path, t.at.shown().as_ref());
                        }
                        if t.needs.by_screen() {
                            hand_over(&app, job, &id, t, &stop);
                        }
                        if !stop.load(Ordering::Relaxed) {
                            tell(&app, job, &t.entry.path, t.at.shown().as_ref());
                        }
                    }
                    let _ = fs::remove_file(&t.file);
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

fn handed_files(job: u32) -> Result<(ThumbFiles, f64), String> {
    handing()
        .get(&job)
        .map(|h| (h.at.clone(), h.ratio))
        .ok_or_else(|| format!("ジョブ {job} のファイルはすでに処理が終わっています"))
}

/// 画面が作ったサムネイルを置く。本文は PNG、ヘッダーに job と元の大きさ。
#[tauri::command]
pub(crate) async fn archive_put_thumb(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(png) = request.body() else {
        return Err("リクエスト本文が PNG ではありません".into());
    };
    let num = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u32>().ok())
    };
    let job = num("job").ok_or("ジョブが指定されていません")?;
    let (at, _) = handed_files(job)?;
    thumb::place(png, num("width").zip(num("height")), &at.png)?;
    Ok(())
}

/// 画面が作った波形を置き、ジャケットがなければサムネイルにする。
#[tauri::command]
pub(crate) async fn archive_put_wave(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(wave) = request.body() else {
        return Err("リクエスト本文が波形のデータではありません".into());
    };
    if wave.is_empty() || wave.len() > 1 << 16 {
        return Err(format!("波形のデータの長さ（{}）が不正です", wave.len()));
    }
    let job = request
        .headers()
        .get("job")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or("ジョブが指定されていません")?;
    let (at, ratio) = handed_files(job)?;
    thumb::keep(&at.wave, wave);
    draw_wave_thumb(&at, wave, ratio)
}

/// none は、スクリプトが「このファイルのサムネイルはない」と答えたこと。
#[tauri::command]
pub(crate) fn archive_source_done(job: u32, none: bool) {
    if let Some(h) = handing().get(&job) {
        if none {
            let _ = fs::write(&h.at.none, []);
        }
        let _ = h.done.send(());
    }
}

#[tauri::command]
pub(crate) fn archive_stop(job: u32) {
    job_flag(job).store(true, Ordering::Relaxed);
}
