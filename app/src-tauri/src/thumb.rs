//! サムネイル。作り方はプラグインが決める。ライブラリには置かず、端末のキャッシュに作る（消してもまた作れる）。

use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
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

/// 詳細用の画像 png を out に置き、同じ元の前の版を消す。
pub fn keep_decoded(out: &Path, png: &[u8]) {
    let (Some(dir), Some(name)) = (out.parent(), out.file_name().and_then(|n| n.to_str())) else {
        return;
    };
    let tmp = out.with_extension("tmp");
    let r = fs::create_dir_all(dir)
        .and_then(|()| fs::write(&tmp, png))
        .and_then(|()| fs::rename(&tmp, out));
    if let Err(e) = r {
        log::warn!("詳細用の画像を保存できない: {}: {e}", out.display());
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
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            if name == DECODED && all_found {
                prune_decoded(&e.path(), &places);
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
        for e in fs::read_dir(d.path())
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
                log::warn!("古い詳細用の画像を消せない: {}: {err}", e.path().display());
            }
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

/// 新しいものから順に、手の空いた数だけ並べて作る。できたものごとに done を呼ぶ。
pub fn make_all(reg: &Arc<Registry>, mut jobs: Vec<Job>, done: impl Fn(&Job, Placed) + Sync) {
    jobs.sort_by(|a, b| b.mtime.total_cmp(&a.mtime));
    let next = AtomicUsize::new(0);
    let width = std::thread::available_parallelism().map_or(2, |n| (n.get() / 2).max(1));
    std::thread::scope(|s| {
        for _ in 0..width {
            s.spawn(|| {
                let mut runner = Runner::new(Arc::clone(reg));
                while let Some(job) = jobs.get(next.fetch_add(1, Ordering::Relaxed)) {
                    match make(&mut runner, job) {
                        Ok(Some(placed)) => done(job, placed),
                        Ok(None) => {}
                        Err(e) => log::warn!("サムネイルを作れない: {e}"),
                    }
                }
            });
        }
    });
}
