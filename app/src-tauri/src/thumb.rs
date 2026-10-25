//! 画像のサムネイル。ライブラリには置かず、端末のキャッシュに作る（消してもまた作れる）。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};

/// 長いほうの辺の長さ（px）。
const EDGE: u32 = 512;

pub struct Job {
    pub id: String,
    pub src: PathBuf,
    pub out: PathBuf,
    pub mtime: f64,
}

/// 置き場所の名前に使う、版をまたいでも変わらないハッシュ（FNV-1a）。
fn fnv(parts: &[&[u8]]) -> u64 {
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

/// 「<元の場所のハッシュ>-<更新日時と大きさのハッシュ>.png」。元が変わると後ろ半分が変わる。
pub fn path_for(dir: &Path, src: &Path) -> Option<PathBuf> {
    let m = fs::metadata(src).ok()?;
    let t = m
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let place = fnv(&[src.as_os_str().as_encoded_bytes()]);
    let version = fnv(&[&t.to_le_bytes(), &m.len().to_le_bytes()]);
    Some(dir.join(format!("{place:016x}-{version:016x}.png")))
}

/// 名前の前半（元の場所のハッシュ）。いまの名前の形でなければ None。
fn place_of(name: &str) -> Option<&str> {
    let (place, version) = name.strip_suffix(".png")?.split_once('-')?;
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

pub fn make(src: &Path, out: &Path) -> Result<(), String> {
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
    if img.width() > EDGE || img.height() > EDGE {
        img = img.thumbnail(EDGE, EDGE);
    }
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(|e| err(&e))?;
    }
    let tmp = out.with_extension("tmp");
    img.save_with_format(&tmp, ImageFormat::Png)
        .map_err(|e| err(&e))?;
    fs::rename(&tmp, out).map_err(|e| err(&e))
}

/// 新しいものから順に、手の空いた数だけ並べて作る。できたものごとに done を呼ぶ。
pub fn make_all(mut jobs: Vec<Job>, done: impl Fn(&Job) + Sync) {
    jobs.sort_by(|a, b| b.mtime.total_cmp(&a.mtime));
    let next = AtomicUsize::new(0);
    let width = std::thread::available_parallelism().map_or(2, |n| (n.get() / 2).max(1));
    std::thread::scope(|s| {
        for _ in 0..width {
            s.spawn(|| {
                while let Some(job) = jobs.get(next.fetch_add(1, Ordering::Relaxed)) {
                    match make(&job.src, &job.out) {
                        Ok(()) => done(job),
                        Err(e) => log::warn!("サムネイルを作れない: {e}"),
                    }
                }
            });
        }
    });
}
