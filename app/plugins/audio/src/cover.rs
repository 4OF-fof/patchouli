use std::io::Cursor;

use image::{ImageFormat, ImageReader};
use symphonia::core::meta::{StandardVisualKey, Visual};

use crate::File;
use crate::analyze;

/// タグに入っている絵（表のジャケットを優先）を、長いほうの辺が edge 以下の PNG にする。絵がなければ none。
pub fn cover(f: &File, edge: u32) -> Result<Option<Vec<u8>>, String> {
    let mut format = analyze::reader(&f.ext, f)?;
    let mut meta = format.metadata();
    let mut all: Vec<Visual> = Vec::new();
    loop {
        if let Some(rev) = meta.current() {
            all.extend(rev.media.visuals.iter().cloned());
        }
        if meta.pop().is_none() {
            break;
        }
    }
    let front = all
        .iter()
        .position(|v| v.usage == Some(StandardVisualKey::FrontCover));
    let Some(v) = all.into_iter().nth(front.unwrap_or(0)) else {
        return Ok(None);
    };
    let mut img = ImageReader::new(Cursor::new(&v.data))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("ジャケットの絵を読めません：{e}"))?;
    if img.width() > edge || img.height() > edge {
        img = img.thumbnail(edge, edge);
    }
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(Some(png))
}
