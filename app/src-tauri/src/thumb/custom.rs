use std::collections::HashSet;
use std::error::Error;
use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io::{ErrorKind, Seek};
use std::path::{Path, PathBuf};

use image::{DynamicImage, RgbaImage};
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::AudioFile;
use lofty::flac::FlacFile;
use lofty::id3::v2::Id3v2Version;
use lofty::mpeg::MpegFile;
use lofty::ogg::OggPictureStorage;
use lofty::picture::{MimeType, Picture, PictureType};

use crate::library::{CustomThumb, STATE_DIR, check_name, mtime_of};

pub const EDGE: u32 = 1024;
const DIR: &str = "thumbnails";
const PLAIN: &str = ".png";
/// タグに埋め込めない形式で、再生画面のジャケットにも使う画像
const AS_JACKET: &str = ".jacket.png";

fn dir_of(root: &Path) -> PathBuf {
    root.join(STATE_DIR).join(DIR)
}

fn places(root: &Path, id: &str) -> Result<[PathBuf; 2], String> {
    check_name(id)?;
    let dir = dir_of(root);
    Ok([PLAIN, AS_JACKET].map(|s| dir.join(format!("{id}{s}"))))
}

pub struct Names {
    dir: PathBuf,
    names: HashSet<OsString>,
}

impl Names {
    pub fn read(root: &Path) -> Names {
        let dir = dir_of(root);
        let names = fs::read_dir(&dir)
            .map(|rd| rd.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        Names { dir, names }
    }

    pub fn find(&self, id: &str) -> Option<(PathBuf, CustomThumb)> {
        let (name, jacket) = [(AS_JACKET, true), (PLAIN, false)]
            .into_iter()
            .map(|(s, jacket)| (format!("{id}{s}"), jacket))
            .find(|(name, _)| self.names.contains(OsStr::new(name)))?;
        let path = self.dir.join(name);
        let size = imagesize::size(&path).ok()?;
        let custom = CustomThumb {
            width: size.width as u32,
            height: size.height as u32,
            jacket,
            stamp: mtime_of(&path),
        };
        Some((path, custom))
    }
}

pub fn save(root: &Path, id: &str, png: &[u8], jacket: bool) -> Result<(), String> {
    let [plain, as_jacket] = places(root, id)?;
    let (out, other) = if jacket {
        (as_jacket, plain)
    } else {
        (plain, as_jacket)
    };
    let err = |e: std::io::Error| format!("{}: {e}", out.display());
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let tmp = out.with_extension("tmp");
    fs::write(&tmp, png)
        .and_then(|()| fs::rename(&tmp, &out))
        .map_err(|e| {
            let _ = fs::remove_file(&tmp);
            err(e)
        })?;
    remove_file(&other)
}

fn remove_file(p: &Path) -> Result<(), String> {
    match fs::remove_file(p) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(format!("{}: {e}", p.display())),
        _ => Ok(()),
    }
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    places(root, id)?.iter().try_for_each(|p| remove_file(p))
}

pub fn files_of(root: &Path, id: &str) -> Vec<PathBuf> {
    places(root, id)
        .into_iter()
        .flatten()
        .filter(|p| p.exists())
        .collect()
}

pub fn clipboard_png() -> Result<Vec<u8>, String> {
    let image = arboard::Clipboard::new()
        .and_then(|mut c| c.get_image())
        .map_err(|e| match e {
            arboard::Error::ContentNotAvailable => "クリップボードに画像がありません".to_string(),
            e => format!("クリップボードの読み込みに失敗しました：{e}"),
        })?;
    let (width, height) = (image.width as u32, image.height as u32);
    let pixels = RgbaImage::from_raw(width, height, image.bytes.into_owned())
        .ok_or("クリップボードの画像の読み込みに失敗しました")?;
    super::encode(DynamicImage::ImageRgba8(pixels), EDGE)
}

pub fn can_embed(ext: &str) -> bool {
    matches!(ext, "mp3" | "flac")
}

pub fn embed(path: &Path, ext: &str, png: &[u8]) -> Result<(), String> {
    write_cover(path, ext, png).map_err(|e| format!("ジャケットの書き込みに失敗しました：{e}"))
}

// 汎用の Tag に変換すると対応していないフレームが失われるので、形式ごとの型で読み書きする
fn write_cover(path: &Path, ext: &str, png: &[u8]) -> Result<(), Box<dyn Error>> {
    let mut file = File::options().read(true).write(true).open(path)?;
    let cover = Picture::unchecked(png.to_vec())
        .pic_type(PictureType::CoverFront)
        .mime_type(MimeType::Png)
        .build();
    if ext == "flac" {
        let mut flac = FlacFile::read_from(&mut file, ParseOptions::new())?;
        flac.remove_picture_type(PictureType::CoverFront);
        flac.insert_picture(cover, None)?;
        file.rewind()?;
        return Ok(flac.save_to(&mut file, WriteOptions::new())?);
    }
    let mut mp3 = MpegFile::read_from(&mut file, ParseOptions::new())?;
    let mut tag = mp3.remove_id3v2().unwrap_or_default();
    tag.remove_picture_type(PictureType::CoverFront);
    tag.insert_picture(cover);
    let v3 = tag.original_version() == Id3v2Version::V3;
    mp3.set_id3v2(tag);
    file.rewind()?;
    Ok(mp3.save_to(&mut file, WriteOptions::new().use_id3v23(v3))?)
}
