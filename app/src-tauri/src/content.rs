//! 自動分類で読む区間を、プラグインに作らせて集める。
//! sandbox が受け持つ形式は裏で WASM を呼び、elevated が受け持つ形式は画面に頼む（content-wanted）。
//! elevated が api.sandbox() で呼んだ WASM の区間は、画面に渡さずにここで持ち、画面が返した区間と合わせる。

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

use crate::library::StoredItem;
use crate::plugin::{By, ContentBudget, ContentMedia, ContentPart, Part, Registry, Runner, UiRef};

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

/// 画面に頼んだ 1 件。
struct Job {
    name: String,
    ext: String,
    file: PathBuf,
    plugins: Arc<Registry>,
    stop: Arc<AtomicBool>,
    sandbox: Vec<ContentPart>,
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

/// items の区間を集める。いまは集めた数と時間をログに出すだけ。
pub fn collect(app: &tauri::AppHandle, plugins: &Arc<Registry>, items: &[StoredItem]) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = current().lock() {
        c.store(true, Ordering::Relaxed);
        *c = Arc::clone(&stop);
    }
    if let Ok(mut j) = jobs().lock() {
        j.clear();
    }
    let mut sandbox = Vec::new();
    let mut wanted = Vec::new();
    for it in items.iter().filter(|it| !it.note) {
        let ext = it.ext.to_lowercase();
        match plugins.handles(&ext, Part::Content) {
            Some(By::Sandbox) => sandbox.push((it.name.clone(), ext, it.file.clone())),
            Some(By::Elevated) => {
                let Some(ui) = plugins.ui_of(&ext, Part::Content) else {
                    continue;
                };
                let job = NEXT.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut j) = jobs().lock() {
                    j.insert(
                        job,
                        Job {
                            name: it.name.clone(),
                            ext: ext.clone(),
                            file: it.file.clone(),
                            plugins: Arc::clone(plugins),
                            stop: Arc::clone(&stop),
                            sandbox: Vec::new(),
                        },
                    );
                }
                wanted.push(Wanted {
                    job,
                    ui,
                    id: it.id.clone(),
                    name: it.name.clone(),
                    ext,
                    file: it.file.clone(),
                });
            }
            None => {}
        }
    }
    log::info!(
        "区間を集める: sandbox {} 件・elevated {} 件",
        sandbox.len(),
        wanted.len()
    );
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
    std::thread::spawn(move || {
        let mut runner = Runner::new(plugins);
        runner.set_stop(Arc::clone(&stop));
        for (name, ext, file) in sandbox {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            let started = std::time::Instant::now();
            match runner.content(&ext, &file, budget()) {
                Some(Ok(parts)) => log::info!(
                    "区間を作った: {name}.{ext} {}（{:.1} 秒）",
                    counts(&parts),
                    started.elapsed().as_secs_f32()
                ),
                Some(Err(e)) => log::warn!("区間を作れない: {name}.{ext}: {e}"),
                None => {}
            }
        }
    });
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
        j.sandbox = parts;
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

/// 画面が作り終えた区間。body は、頭の 4 バイトが区間の形（SentPart）の JSON の長さで、JSON、中身と続く。
/// error があれば、作れなかった。ms は画面で作るのにかかった時間。
pub fn put(job: u64, body: &[u8], error: Option<&str>, ms: f64) -> Result<(), String> {
    let j = jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&job)
        .ok_or("区間を待っていない項目です")?;
    if let Some(e) = error {
        log::warn!("区間を作れない: {}.{}: {e}", j.name, j.ext);
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
    let mut parts = j.sandbox;
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
        "区間を作った: {}.{} {}（{:.1} 秒）",
        j.name,
        j.ext,
        counts(&parts),
        ms / 1000.0
    );
    Ok(())
}
