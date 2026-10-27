//! サムネイル。作り方はプラグインが決める。ライブラリには置かず、端末のキャッシュに作る（消してもまた作れる）。

use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};

use crate::plugin::{Reads, Registry, Runner};

/// 長いほうの辺の長さ（px）。
const EDGE: u32 = 512;

pub struct Job {
    pub id: String,
    pub src: PathBuf,
    /// 拡張子（小文字）。
    pub ext: String,
    /// 置き場所。名前は作ったあとで、読んだ設定も入れて決める。
    pub dir: PathBuf,
    pub mtime: f64,
}

/// 置き場所の名前に使う、版をまたいでも変わらないハッシュ（FNV-1a）。
pub(crate) fn fnv(parts: &[&[u8]]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for p in parts {
        for b in *p {
            h = (h ^ u64::from(*b)).wrapping_mul(0x100000001b3);
        }
    }
    h
}

/// ライブラリごとのサムネイルの置き場所。
pub fn dir_for(cache: &Path, root: &Path) -> PathBuf {
    cache.join("thumbs").join(format!(
        "{:016x}",
        fnv(&[root.as_os_str().as_encoded_bytes()])
    ))
}

/// 取っておく詳細用の画像の置き場所。プラグイン id の形式 format ごとに分ける。
/// サムネイルの置き場所の中に置き、名前の形はサムネイルと同じ（読んだ設定はない）。
pub fn decoded_dir(thumbs: &Path, id: &str, format: &str) -> PathBuf {
    thumbs.join(DECODED).join(format!(
        "{:016x}",
        fnv(&[id.as_bytes(), b"\0", format.as_bytes()])
    ))
}

const DECODED: &str = "decoded";

/// 波形の置き場所。名前の形はサムネイルと同じ（読んだ設定はない）で、拡張子は .wave。
pub fn wave_path(thumbs: &Path, src: &Path) -> Option<PathBuf> {
    path_for(&thumbs.join(WAVES), src, &Reads::new()).map(|p| p.with_extension("wave"))
}

const WAVES: &str = "waves";

/// 詳細用の画像や波形 bytes を out に置き、同じ元の前の版を消す。
pub fn keep(out: &Path, bytes: &[u8]) {
    let (Some(dir), Some(name)) = (out.parent(), out.file_name().and_then(|n| n.to_str())) else {
        return;
    };
    let tmp = out.with_extension("tmp");
    let r = fs::create_dir_all(dir)
        .and_then(|()| fs::write(&tmp, bytes))
        .and_then(|()| fs::rename(&tmp, out));
    if let Err(e) = r {
        log::warn!("キャッシュに保存できない: {}: {e}", out.display());
        let _ = fs::remove_file(&tmp);
        return;
    }
    let place = place_of(name);
    for e in fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        let n = e.file_name();
        if n.to_str()
            .is_some_and(|n| n != name && place_of(n) == place)
        {
            let _ = fs::remove_file(e.path());
        }
    }
}

/// 「<元の場所のハッシュ>-<更新日時と大きさ、作るときに読んだ設定のハッシュ>.png」。
/// 元か、読んだ設定の値が変わると後ろ半分が変わる。
pub fn path_for(dir: &Path, src: &Path, reads: &Reads) -> Option<PathBuf> {
    let m = fs::metadata(src).ok()?;
    let t = m
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let place = fnv(&[src.as_os_str().as_encoded_bytes()]);
    // 設定を読まないものは、前の版と同じ名前になる
    let settings = if reads.is_empty() {
        Vec::new()
    } else {
        serde_json::to_vec(reads).ok()?
    };
    let version = fnv(&[&t.to_le_bytes(), &m.len().to_le_bytes(), &settings]);
    Some(dir.join(format!("{place:016x}-{version:016x}.png")))
}

/// 名前の前半（元の場所のハッシュ）。いまの名前の形でなければ None。
fn place_of(name: &str) -> Option<&str> {
    let stem = name
        .strip_suffix(".png")
        .or_else(|| name.strip_suffix(".wave"))?;
    let (place, version) = stem.split_once('-')?;
    let hex = |s: &str| s.len() == 16 && s.bytes().all(|b| b.is_ascii_hexdigit());
    (hex(place) && hex(version)).then_some(place)
}

/// 使われていないと確かに分かるサムネイルを消す。current はいまの画像すべてのサムネイルの場所。
/// - 元が更新された画像の、前のサムネイル
/// - いまの名前の形でないもの（前の版の形式）
/// - all_found のとき（ライブラリを残らず読めたとき）は、ライブラリにもうない画像のもの
///
/// 書きかけ（.tmp）には触らない。
pub fn prune(dir: &Path, current: &[PathBuf], all_found: bool) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let names: HashSet<&str> = current
        .iter()
        .filter_map(|p| p.file_name()?.to_str())
        .collect();
    let places: HashSet<&str> = names.iter().filter_map(|n| place_of(n)).collect();
    for e in rd.filter_map(Result::ok) {
        let name = e.file_name();
        let Some(name) = name.to_str() else { continue };
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            if name == DECODED && all_found {
                prune_decoded(&e.path(), &places);
            } else if name == WAVES && all_found {
                prune_gone(&e.path(), &places);
            }
            continue;
        }
        if names.contains(name) || name.ends_with(".tmp") {
            continue;
        }
        let stale = match place_of(name) {
            Some(place) => places.contains(place) || all_found,
            None => true,
        };
        if stale && let Err(err) = fs::remove_file(e.path()) {
            log::warn!("古いサムネイルを消せない: {}: {err}", e.path().display());
        }
    }
}

/// 取っておいた詳細用の画像のうち、ライブラリにもう素材がないものを消す。
/// places は、いまの素材のサムネイルの名前の前半。サムネイルを作らない素材のものも消える。
fn prune_decoded(dir: &Path, places: &HashSet<&str>) {
    for d in fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        prune_gone(&d.path(), places);
    }
}

/// dir の中の、ライブラリにもう素材がないもの（名前の前半が places にないもの）を消す。
fn prune_gone(dir: &Path, places: &HashSet<&str>) {
    for e in fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        let name = e.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.ends_with(".tmp") || place_of(name).is_some_and(|p| places.contains(p)) {
            continue;
        }
        if let Err(err) = fs::remove_file(e.path()) {
            log::warn!("古いキャッシュを消せない: {}: {err}", e.path().display());
        }
    }
}

/// 画像を、長いほうの辺が edge 以下になるよう縮めた PNG。写真の向き（EXIF）を反映する。
pub fn shrink(src: &Path, edge: u32) -> Result<Vec<u8>, String> {
    let err = |e: &dyn std::fmt::Display| format!("{}: {e}", src.display());
    let mut dec = ImageReader::open(src)
        .map_err(|e| err(&e))?
        .with_guessed_format()
        .map_err(|e| err(&e))?
        .into_decoder()
        .map_err(|e| err(&e))?;
    let orientation = dec.orientation().map_err(|e| err(&e))?;
    let mut img = DynamicImage::from_decoder(dec).map_err(|e| err(&e))?;
    img.apply_orientation(orientation);
    encode(img, edge).map_err(|e| err(&e))
}

/// 長いほうの辺が edge より長ければ縮めて、PNG にする。
pub fn encode(mut img: DynamicImage, edge: u32) -> Result<Vec<u8>, String> {
    if img.width() > edge || img.height() > edge {
        img = img.thumbnail(edge, edge);
    }
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(png)
}

/// サムネイルの波形の棒の数。「今週」の大きさで、詳細と同じ幅 3px・間 1px ほどになる。
const WAVE_BARS: usize = 48;

/// 棒の幅と、棒と次の棒の間の比。src/components/media/AudioPlayer と合わせる。
const WAVE_BAR: f32 = 3.0;
const WAVE_GAP: f32 = 1.0;

/// 波形 wave（区間ごとの音の大きさを、0〜255 にしたもの）を、縦横比 ratio（幅 / 高さ）の枠に描いた PNG。
/// 幅を棒の数で分け、棒ごとに区間の大きさの二乗平均の平方根を、真ん中から上下に同じ長さで伸ばした角丸の棒にする。
/// いちばん大きい棒を枠の高さに合わせる。
pub fn draw_wave(wave: &[u8], ratio: f64) -> Result<Vec<u8>, String> {
    if wave.is_empty() {
        return Err("波形のデータが空です".into());
    }
    let ratio = ratio.clamp(0.25, 4.0);
    let (w, h) = if ratio >= 1.0 {
        (EDGE, (f64::from(EDGE) / ratio).round() as u32)
    } else {
        ((f64::from(EDGE) * ratio).round() as u32, EDGE)
    };
    // 背景は透かし、暗い地にも明るい地にも見える中間の灰色（tokens.css の --muted）で描く
    let [r, g, b] = [0x8e, 0x92, 0x9a];
    let mut img = image::RgbaImage::new(w, h);
    let bars = bar_levels(wave, WAVE_BARS);
    let pitch = w as f32 / WAVE_BARS as f32;
    let bw = pitch * WAVE_BAR / (WAVE_BAR + WAVE_GAP);
    let rad = bw / 2.0;
    let mid = h as f32 / 2.0;
    // 角を滑らかにするため、1 px を 4×4 に分けて覆う割合を数える
    const SUB: u32 = 4;
    for (k, &level) in bars.iter().enumerate() {
        let len = (level * h as f32).max(bw);
        let (left, top) = (k as f32 * pitch + (pitch - bw) / 2.0, mid - len / 2.0);
        let (right, bottom) = (left + bw, top + len);
        let inside = |x: f32, y: f32| {
            if x < left || x > right || y < top || y > bottom {
                return false;
            }
            let cy = y.clamp(top + rad, bottom - rad);
            let (dx, dy) = (x - (left + rad), y - cy);
            dx * dx + dy * dy <= rad * rad
        };
        for y in top.floor().max(0.0) as u32..(bottom.ceil() as u32).min(h) {
            for x in left.floor().max(0.0) as u32..(right.ceil() as u32).min(w) {
                let hits = (0..SUB * SUB)
                    .filter(|i| {
                        let sx = x as f32 + ((i % SUB) as f32 + 0.5) / SUB as f32;
                        let sy = y as f32 + ((i / SUB) as f32 + 0.5) / SUB as f32;
                        inside(sx, sy)
                    })
                    .count();
                if hits > 0 {
                    let a = (hits * 255 / (SUB * SUB) as usize) as u8;
                    img.put_pixel(x, y, image::Rgba([r, g, b, a]));
                }
            }
        }
    }
    encode(DynamicImage::ImageRgba8(img), EDGE)
}

/// 波形を n 本の棒に分けた、棒ごとの大きさ（いちばん大きい棒を 1 とする）。
fn bar_levels(wave: &[u8], n: usize) -> Vec<f32> {
    let len = wave.len();
    let bars: Vec<f32> = (0..n)
        .map(|k| {
            let from = (k * len / n).min(len - 1);
            let to = ((k + 1) * len / n).clamp(from + 1, len);
            let sq: f32 = wave[from..to].iter().map(|&v| f32::from(v).powi(2)).sum();
            (sq / (to - from) as f32).sqrt()
        })
        .collect();
    let top = bars.iter().fold(0.0f32, |m, &v| m.max(v));
    bars.iter()
        .map(|&v| if top > 0.0 { v / top } else { 0.0 })
        .collect()
}

/// 置いたサムネイルの場所と素材の大きさ（わからなければサムネイルの大きさ）、作るときに読んだ設定。
pub struct Placed {
    pub out: PathBuf,
    pub size: (u32, u32),
    pub reads: Reads,
}

/// プラグインにサムネイルを作らせて置く。プラグインが作らなければ None。
fn make(runner: &mut Runner, job: &Job) -> Result<Option<Placed>, String> {
    let err = |e: &dyn std::fmt::Display| format!("{}: {e}", job.src.display());
    let Some((png, original, reads)) = runner.thumbnail(&job.ext, &job.src, EDGE)? else {
        return Ok(None);
    };
    let out = path_for(&job.dir, &job.src, &reads).ok_or_else(|| err(&"読み込みに失敗しました"))?;
    let size = place(&png, original, &out).map_err(|e| err(&e))?;
    Ok(Some(Placed { out, size, reads }))
}

/// プラグインが作ったサムネイルを確かめて out に置く。返すのは素材の大きさ（わからなければサムネイルの大きさ）。
pub fn place(png: &[u8], original: Option<(u32, u32)>, out: &Path) -> Result<(u32, u32), String> {
    // PNG でないものや、大きすぎるものは置かない
    let size = imagesize::blob_size(png).map_err(|e| e.to_string())?;
    let (w, h) = (size.width as u32, size.height as u32);
    if imagesize::image_type(png).ok() != Some(imagesize::ImageType::Png)
        || w > EDGE * 2
        || h > EDGE * 2
    {
        return Err("プラグインが返したサムネイルが PNG ではないか、サイズが大きすぎます".into());
    }
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = out.with_extension("tmp");
    fs::write(&tmp, png).map_err(|e| e.to_string())?;
    fs::rename(&tmp, out).map_err(|e| e.to_string())?;
    Ok(original.filter(|(w, h)| *w > 0 && *h > 0).unwrap_or((w, h)))
}

/// プラグインにサムネイルを作らせている元の場所。作り終わるまでは、波形をサムネイルにしない（ジャケットを先にする）。
fn making() -> &'static Mutex<HashSet<PathBuf>> {
    static M: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

/// src のサムネイルを、プラグインに作らせることにした。
pub fn start_making(src: &Path) {
    if let Ok(mut m) = making().lock() {
        m.insert(src.to_owned());
    }
}

/// src のサムネイルを、プラグインが作り終えた（作らなかったときも）。
pub fn end_making(src: &Path) {
    if let Ok(mut m) = making().lock() {
        m.remove(src);
    }
}

/// src のサムネイルを、プラグインが作っているところか。
pub fn is_making(src: &Path) -> bool {
    making().lock().is_ok_and(|m| m.contains(src))
}

/// 裏で作るサムネイルの、まだできていない素材の id。
fn pending_ids() -> &'static Mutex<HashSet<String>> {
    static P: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

/// 裏で作っているサムネイルの、残りの数。
pub fn pending() -> usize {
    pending_ids().lock().map_or(0, |p| p.len())
}

/// 裏でサムネイルを作っている素材の id。
pub fn pending_items() -> Vec<String> {
    pending_ids()
        .lock()
        .map(|p| p.iter().cloned().collect())
        .unwrap_or_default()
}

/// stop を呼んだ回数。make_all は始めたときと違っていたら打ち切る。
static STOPS: AtomicUsize = AtomicUsize::new(0);

/// いま裏で作っているサムネイルを、作っている 1 件で打ち切らせる。あとから頼んだものは作る。
pub fn stop() {
    STOPS.fetch_add(1, Ordering::Relaxed);
}

fn set_pending<'a>(ids: impl IntoIterator<Item = &'a String>, on: bool) {
    if let Ok(mut p) = pending_ids().lock() {
        for id in ids {
            if on {
                p.insert(id.clone());
            } else {
                p.remove(id);
            }
        }
    }
}

/// 新しいものから順に、手の空いた数だけ並べて作る。仕事ごとに done を呼ぶ（作らなかったときと失敗したときは None）。
/// reg が止められたか stop が呼ばれたら、作っているものを終えたところで、残りは作らずに戻る。
pub fn make_all(
    reg: &Arc<Registry>,
    mut jobs: Vec<Job>,
    done: impl Fn(&Job, Option<Placed>) + Sync,
) {
    jobs.sort_by(|a, b| b.mtime.total_cmp(&a.mtime));
    set_pending(jobs.iter().map(|j| &j.id), true);
    let stops = STOPS.load(Ordering::Relaxed);
    let next = AtomicUsize::new(0);
    let width = std::thread::available_parallelism().map_or(2, |n| (n.get() / 2).max(1));
    std::thread::scope(|s| {
        for _ in 0..width {
            s.spawn(|| {
                let mut runner = Runner::new(Arc::clone(reg));
                while !reg.stopped()
                    && STOPS.load(Ordering::Relaxed) == stops
                    && let Some(job) = jobs.get(next.fetch_add(1, Ordering::Relaxed))
                {
                    let placed = make(&mut runner, job).unwrap_or_else(|e| {
                        log::warn!("サムネイルを作れない: {e}");
                        None
                    });
                    done(job, placed);
                    set_pending([&job.id], false);
                }
            });
        }
    });
    let left = jobs
        .len()
        .saturating_sub(next.load(Ordering::Relaxed).min(jobs.len()));
    let undone = &jobs[jobs.len() - left..];
    for j in undone {
        end_making(&j.src);
    }
    set_pending(undone.iter().map(|j| &j.id), false);
}
