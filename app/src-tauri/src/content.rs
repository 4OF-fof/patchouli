//! 自動分類で読む区間を、プラグインに作らせてベクトルにする。
//! sandbox が受け持つ形式は裏で WASM を呼び、elevated が受け持つ形式は画面に頼む（content-wanted）。
//! elevated が api.sandbox() で呼んだ WASM の区間は、画面に渡さずにここで持ち、画面が返した区間と合わせる。
//! ベクトルにするのは 1 つのスレッドで、区間を作る側はそこへ 1 件ずつ渡す。

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, sync_channel};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::library::StoredItem;
use crate::plugin::{By, ContentBudget, ContentMedia, ContentPart, Part, Registry, Runner, UiRef};
use crate::vectors::{self, Store};
use crate::{embed, thumb};

fn budget() -> ContentBudget {
    ContentBudget {
        max_image_parts: 240,
        max_audio_parts: 120,
        max_text_parts: 120,
        max_images: 3,
        edge: 512,
        max_audio_secs: 30.0,
    }
}

fn budget_key() -> String {
    let b = budget();
    format!(
        "{},{},{},{},{},{}",
        b.max_image_parts,
        b.max_audio_parts,
        b.max_text_parts,
        b.max_images,
        b.edge,
        b.max_audio_secs
    )
}

/// ベクトルにする 1 件。parts が空なら、thumb で代える。
struct Work {
    id: String,
    name: String,
    sig: String,
    parts: Vec<ContentPart>,
    thumb: Option<PathBuf>,
}

/// 画面に頼んだ 1 件。
struct Job {
    work: Work,
    ext: String,
    file: PathBuf,
    plugins: Arc<Registry>,
    stop: Arc<AtomicBool>,
    tx: SyncSender<Work>,
}

#[derive(Serialize)]
struct Wanted {
    job: u64,
    #[serde(flatten)]
    ui: UiRef,
    id: String,
    name: String,
    ext: String,
    file: PathBuf,
}

static NEXT: AtomicU64 = AtomicU64::new(0);

fn jobs() -> &'static Mutex<HashMap<u64, Job>> {
    static J: OnceLock<Mutex<HashMap<u64, Job>>> = OnceLock::new();
    J.get_or_init(|| Mutex::new(HashMap::new()))
}

/// いま動いている集めの中止の印。新しく始めると、前のものを止める。
fn current() -> &'static Mutex<Arc<AtomicBool>> {
    static C: OnceLock<Mutex<Arc<AtomicBool>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(Arc::new(AtomicBool::new(false))))
}

fn counts(parts: &[ContentPart]) -> String {
    let (mut images, mut audio, mut text) = (0, 0, 0);
    for p in parts {
        match p.media {
            ContentMedia::Images(_) => images += 1,
            ContentMedia::Audio(_) => audio += 1,
            ContentMedia::Text(_) => text += 1,
        }
    }
    format!("画像 {images}・音声 {audio}・文章 {text}")
}

/// 項目の文章。タグは候補として当てるものなので入れない。
pub fn text_of(it: &StoredItem) -> String {
    let mut s = it.name.replace(['_', '-'], " ");
    for t in [Some(&it.memo), it.body.as_ref()].into_iter().flatten() {
        if !t.is_empty() {
            s.push('\n');
            s.push_str(t);
        }
    }
    s
}

fn hash(s: &str) -> String {
    format!("{:016x}", thumb::fnv(&[s.as_bytes()]))
}

/// 作りかけを止め、画面に頼んだものも取り下げる。
pub fn stop(app: &tauri::AppHandle) {
    if let Ok(c) = current().lock() {
        c.store(true, Ordering::Relaxed);
    }
    if let Ok(mut j) = jobs().lock() {
        j.clear();
    }
    let _ = app.emit("content-wanted", json!({ "items": [] }));
}

/// items のベクトルを、変わったものだけ作り直す。新しく始めると、前のものは止める。
pub fn collect(
    app: &tauri::AppHandle,
    plugins: &Arc<Registry>,
    items: &[StoredItem],
    thumbs: &Path,
) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = current().lock() {
        c.store(true, Ordering::Relaxed);
        *c = Arc::clone(&stop);
    }
    if let Ok(mut j) = jobs().lock() {
        j.clear();
    }
    if !embed::installed() {
        log::info!("llama.cpp かモデルがないので、ベクトルを作らない");
        return;
    }
    let mut store = match Store::open(&vectors::path_for(thumbs)) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("ベクトルのキャッシュを開けない: {e}");
            return;
        }
    };
    let keep: HashSet<String> = items.iter().map(|it| it.id.clone()).collect();
    match store.retain(&keep) {
        Ok(n) if n > 0 => log::info!("消えた項目のベクトルを片付けた: {n} 件"),
        Ok(_) => {}
        Err(e) => log::warn!("消えた項目のベクトルを片付けられない: {e}"),
    }
    let (have_text, have_content) = (store.text_sigs(), store.content_sigs());
    let texts: Vec<(String, String, String)> = items
        .iter()
        .filter_map(|it| {
            let text = text_of(it);
            let sig = hash(&text);
            (have_text.get(&it.id) != Some(&sig)).then(|| (it.id.clone(), sig, text))
        })
        .collect();
    let (tx, rx) = sync_channel::<Work>(1);
    let mut sandbox = Vec::new();
    let mut wanted = Vec::new();
    let mut by_thumb = Vec::new();
    let key = budget_key();
    for it in items.iter().filter(|it| !it.note) {
        let ext = it.ext.to_lowercase();
        let thumb = it.thumb.clone().filter(|t| t.is_file());
        let by = plugins.handles(&ext, Part::Content);
        let sig = match (plugins.content_owner(&ext), thumb.as_ref()) {
            (Some(owner), _) => format!("{}|{owner}|{key}", it.mtime),
            (None, Some(t)) => format!(
                "{}|thumb|{}",
                it.mtime,
                t.file_name().unwrap_or_default().to_string_lossy()
            ),
            (None, None) => continue,
        };
        if have_content.get(&it.id) == Some(&sig) {
            continue;
        }
        let work = Work {
            id: it.id.clone(),
            name: format!("{}.{}", it.name, it.ext),
            sig,
            parts: Vec::new(),
            thumb,
        };
        match by {
            Some(By::Sandbox) => sandbox.push((ext, it.file.clone(), work)),
            Some(By::Elevated) => {
                let Some(ui) = plugins.ui_of(&ext, Part::Content) else {
                    continue;
                };
                let job = NEXT.fetch_add(1, Ordering::Relaxed);
                wanted.push(Wanted {
                    job,
                    ui,
                    id: it.id.clone(),
                    name: it.name.clone(),
                    ext: ext.clone(),
                    file: it.file.clone(),
                });
                if let Ok(mut j) = jobs().lock() {
                    j.insert(
                        job,
                        Job {
                            work,
                            ext,
                            file: it.file.clone(),
                            plugins: Arc::clone(plugins),
                            stop: Arc::clone(&stop),
                            tx: tx.clone(),
                        },
                    );
                }
            }
            Some(By::Unknown) | None => by_thumb.push(work),
        }
    }
    log::info!(
        "ベクトルを作る: 文章 {} 件・sandbox {} 件・elevated {} 件・サムネイル {} 件",
        texts.len(),
        sandbox.len(),
        wanted.len(),
        by_thumb.len()
    );
    {
        let stop = Arc::clone(&stop);
        let app = app.clone();
        crate::background::spawn(move || {
            if embed_all(&mut store, texts, by_thumb, &rx, &stop) {
                crate::refresh_suggestions(&app, true);
            }
        });
    }
    if !wanted.is_empty() {
        let b = budget();
        let _ = app.emit(
            "content-wanted",
            json!({
                "items": wanted,
                "budget": {
                    "maxImageParts": b.max_image_parts,
                    "maxAudioParts": b.max_audio_parts,
                    "maxTextParts": b.max_text_parts,
                    "maxImages": b.max_images,
                    "edge": b.edge,
                    "maxAudioSecs": b.max_audio_secs,
                },
            }),
        );
    }
    let plugins = Arc::clone(plugins);
    crate::background::spawn(move || {
        let mut runner = Runner::new(plugins);
        runner.set_stop(Arc::clone(&stop));
        for (ext, file, mut work) in sandbox {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            let started = Instant::now();
            match runner.content(&ext, &file, budget()) {
                Some(Ok(parts)) => {
                    log::info!(
                        "区間を作った: {} {}（{:.1} 秒）",
                        work.name,
                        counts(&parts),
                        started.elapsed().as_secs_f32()
                    );
                    work.parts = parts;
                }
                Some(Err(e)) => log::warn!("区間を作れない: {}: {e}", work.name),
                None => {}
            }
            if tx.send(work).is_err() {
                return;
            }
        }
    });
}

/// texts は（ID・sig・文章）。区間はすべて揃ってから保存するので、途中で止めたものは次に作り直す。
/// 止めたか失敗したら false。
fn embed_all(
    store: &mut Store,
    texts: Vec<(String, String, String)>,
    by_thumb: Vec<Work>,
    rx: &Receiver<Work>,
    stop: &AtomicBool,
) -> bool {
    let started = Instant::now();
    let n = texts.len();
    for (id, sig, text) in texts {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        let v = match embed::text("classification", &text) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("文章をベクトルにできない: {e}");
                return false;
            }
        };
        if let Err(e) = store.put_text(&id, &sig, &v) {
            log::warn!("ベクトルを保存できない: {e}");
            return false;
        }
    }
    if n > 0 {
        log::info!(
            "文章をベクトルにした: {n} 件（{:.1} 秒）",
            started.elapsed().as_secs_f32()
        );
    }
    for w in by_thumb.into_iter().chain(received(rx, stop)) {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        match embed_work(&w, stop) {
            Ok(Some((whole, parts))) => {
                if let Err(e) = store.put_content(&w.id, &w.sig, whole.as_deref(), &parts) {
                    log::warn!("ベクトルを保存できない: {e}");
                    return false;
                }
            }
            Ok(None) => return false,
            Err(e) => {
                log::warn!("ベクトルにできない: {}: {e}", w.name);
                return false;
            }
        }
    }
    !stop.load(Ordering::Relaxed)
}

/// 画面が区間を返さないまま、これだけ何も届かなければ、残りの頼みを取り下げる。sandbox の 1 件にかかる上限より長くする。
const STALL: Duration = Duration::from_secs(180);

/// 届いたものを順に渡す。止めたら終える。
fn received<'a>(rx: &'a Receiver<Work>, stop: &'a AtomicBool) -> impl Iterator<Item = Work> + 'a {
    let mut last = Instant::now();
    std::iter::from_fn(move || {
        loop {
            if stop.load(Ordering::Relaxed) {
                return None;
            }
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(w) => {
                    last = Instant::now();
                    return Some(w);
                }
                Err(RecvTimeoutError::Disconnected) => return None,
                Err(RecvTimeoutError::Timeout) if last.elapsed() >= STALL => {
                    abandon(stop);
                    last = Instant::now();
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    })
}

/// 画面に頼んだもののうち、stop の集めのものを取り下げる。
fn abandon(stop: &AtomicBool) {
    if let Ok(mut j) = jobs().lock() {
        let before = j.len();
        j.retain(|_, job| !std::ptr::eq(Arc::as_ptr(&job.stop), stop));
        let n = before - j.len();
        if n > 0 {
            log::warn!("区間が返ってこないので、{n} 件をあきらめる");
        }
    }
}

type Embedded = (Option<Vec<f32>>, Vec<vectors::Part>);

/// 止めたら None。
fn embed_work(w: &Work, stop: &AtomicBool) -> Result<Option<Embedded>, String> {
    let started = Instant::now();
    let mut parts = Vec::with_capacity(w.parts.len());
    for p in &w.parts {
        if stop.load(Ordering::Relaxed) {
            return Ok(None);
        }
        parts.push(vectors::Part {
            start: p.start,
            end: p.end,
            kind: kind_of(&p.media),
            vec: embed::media(&p.media)?,
        });
    }
    let whole = if let Some(first) = parts.first() {
        let mut sum = vec![0.0; first.vec.len()];
        for p in &parts {
            sum.iter_mut().zip(&p.vec).for_each(|(s, x)| *s += x);
        }
        Some(embed::normalize(sum))
    } else if let Some(t) = &w.thumb {
        Some(embed::image(&std::fs::read(t).map_err(|e| e.to_string())?)?)
    } else {
        None
    };
    log::info!(
        "ベクトルにした: {} {}（{:.1} 秒）",
        w.name,
        if parts.is_empty() {
            "サムネイル".to_owned()
        } else {
            format!("区間 {}", parts.len())
        },
        started.elapsed().as_secs_f32()
    );
    Ok(Some((whole, parts)))
}

/// elevated の中から呼ぶ sandbox の content。区間はここで持ち、位置と種類だけを返す。
#[derive(Serialize)]
pub struct SandboxPart {
    start: Option<f64>,
    end: Option<f64>,
    kind: &'static str,
}

fn kind_of(m: &ContentMedia) -> &'static str {
    match m {
        ContentMedia::Images(_) => "images",
        ContentMedia::Audio(_) => "audio",
        ContentMedia::Text(_) => "text",
    }
}

pub fn sandbox(job: u64) -> Result<Vec<SandboxPart>, String> {
    let (ext, file, plugins, stop) = {
        let j = jobs().lock().map_err(|e| e.to_string())?;
        let j = j.get(&job).ok_or("区間を待っていない項目です")?;
        (
            j.ext.clone(),
            j.file.clone(),
            Arc::clone(&j.plugins),
            Arc::clone(&j.stop),
        )
    };
    let mut runner = Runner::new(plugins);
    runner.set_stop(stop);
    let parts = runner
        .content(&ext, &file, budget())
        .ok_or("この形式の sandbox は content を受け持っていません")??;
    let out = parts
        .iter()
        .map(|p| SandboxPart {
            start: p.start,
            end: p.end,
            kind: kind_of(&p.media),
        })
        .collect();
    if let Some(j) = jobs().lock().map_err(|e| e.to_string())?.get_mut(&job) {
        j.work.parts = parts;
    }
    Ok(out)
}

/// 画面から届く区間の形。中身は images・audio の大きさの順に、形のあとに並ぶ。
#[derive(Deserialize)]
struct SentPart {
    start: Option<f64>,
    end: Option<f64>,
    #[serde(default)]
    images: Vec<usize>,
    audio: Option<usize>,
    text: Option<String>,
}

/// 画面が作り終えた区間を、ベクトルにするスレッドへ渡す。body は、頭の 4 バイトが区間の形（SentPart）の JSON の長さで、JSON、中身と続く。
/// error があれば、作れなかった。ms は画面で作るのにかかった時間。
pub fn put(job: u64, body: &[u8], error: Option<&str>, ms: f64) -> Result<(), String> {
    let Job { mut work, tx, .. } = jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&job)
        .ok_or("区間を待っていない項目です")?;
    if let Some(e) = error {
        log::warn!("区間を作れない: {}: {e}", work.name);
        let _ = tx.send(work);
        return Ok(());
    }
    let len = body
        .first_chunk::<4>()
        .map(|b| u32::from_le_bytes(*b) as usize)
        .ok_or("区間の形がありません")?;
    let sent: Vec<SentPart> = body
        .get(4..4 + len)
        .ok_or("区間の形が足りません")
        .and_then(|b| serde_json::from_slice(b).map_err(|_| "区間の形を読めません"))?;
    let mut at = 4 + len;
    let mut take = |n: usize| -> Result<Vec<u8>, String> {
        let b = body
            .get(at..at + n)
            .ok_or("区間の中身が足りません")?
            .to_vec();
        at += n;
        Ok(b)
    };
    let mut parts = std::mem::take(&mut work.parts);
    for p in sent {
        let media = if !p.images.is_empty() {
            ContentMedia::Images(
                p.images
                    .iter()
                    .map(|&n| take(n))
                    .collect::<Result<_, _>>()?,
            )
        } else if let Some(n) = p.audio {
            ContentMedia::Audio(take(n)?)
        } else if let Some(t) = p.text {
            ContentMedia::Text(t)
        } else {
            continue;
        };
        parts.push(ContentPart {
            start: p.start,
            end: p.end,
            media,
        });
    }
    log::info!(
        "区間を作った: {} {}（{:.1} 秒）",
        work.name,
        counts(&parts),
        ms / 1000.0
    );
    work.parts = parts;
    // ベクトルにするスレッドが前の 1 件を受け取るまで待つ。止めたあとなら捨てる
    let _ = tx.send(work);
    Ok(())
}
