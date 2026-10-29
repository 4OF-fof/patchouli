wit_bindgen::generate!({ world: "plugin", path: "../../app/plugins/sdk/wit" });

use patchouli::plugin::host;
use patchouli::plugin::types::Dimensions;

struct Ppm;

struct Rgb {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

/// 一度に読む量。ホストが一度に返せる量（16 MB）より小さくする。
const STEP: u32 = 8 << 20;

fn read_all(f: &File) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(f.size as usize);
    while (out.len() as u64) < f.size {
        let chunk = host::read(f, out.len() as u64, STEP)?;
        if chunk.is_empty() {
            break;
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn number(b: &[u8], pos: &mut usize) -> Result<u32, String> {
    loop {
        match b.get(*pos) {
            Some(c) if c.is_ascii_whitespace() => *pos += 1,
            Some(b'#') => {
                while b.get(*pos).is_some_and(|c| *c != b'\n') {
                    *pos += 1;
                }
            }
            _ => break,
        }
    }
    let start = *pos;
    while b.get(*pos).is_some_and(u8::is_ascii_digit) {
        *pos += 1;
    }
    std::str::from_utf8(&b[start..*pos])
        .ok()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "PPM のヘッダーの読み込みに失敗しました".into())
}

fn parse(b: &[u8]) -> Result<Rgb, String> {
    if !b.starts_with(b"P6") {
        return Err("P6 形式の PPM ではありません".into());
    }
    let mut pos = 2;
    let width = number(b, &mut pos)?;
    let height = number(b, &mut pos)?;
    let max = number(b, &mut pos)?;
    if width == 0 || height == 0 || max == 0 || max > 65535 {
        return Err("PPM のサイズまたは最大値が正しくありません".into());
    }
    pos += 1;
    let wide = max > 255;
    let samples = width as usize * height as usize * 3;
    let body = b
        .get(pos..pos + samples * if wide { 2 } else { 1 })
        .ok_or("PPM の画像データが不足しています")?;
    let scale = |v: u32| (v * 255 / max) as u8;
    let data = if wide {
        body.chunks_exact(2)
            .map(|c| scale(u32::from(u16::from_be_bytes([c[0], c[1]]))))
            .collect()
    } else if max == 255 {
        body.to_vec()
    } else {
        body.iter().map(|v| scale(u32::from(*v))).collect()
    };
    Ok(Rgb {
        width,
        height,
        data,
    })
}

fn shrink(img: &Rgb, edge: u32) -> Rgb {
    let long = img.width.max(img.height);
    if long <= edge {
        return Rgb {
            width: img.width,
            height: img.height,
            data: img.data.clone(),
        };
    }
    let w = (img.width as u64 * edge as u64 / long as u64).max(1) as u32;
    let h = (img.height as u64 * edge as u64 / long as u64).max(1) as u32;
    let mut data = Vec::with_capacity(w as usize * h as usize * 3);
    for ty in 0..h {
        let (y0, y1) = (
            ty * img.height / h,
            ((ty + 1) * img.height / h).max(ty * img.height / h + 1),
        );
        for tx in 0..w {
            let (x0, x1) = (
                tx * img.width / w,
                ((tx + 1) * img.width / w).max(tx * img.width / w + 1),
            );
            let mut sum = [0u64; 3];
            for y in y0..y1 {
                let row = (y * img.width) as usize * 3;
                for x in x0..x1 {
                    let i = row + x as usize * 3;
                    for (s, v) in sum.iter_mut().zip(&img.data[i..i + 3]) {
                        *s += u64::from(*v);
                    }
                }
            }
            let n = u64::from((y1 - y0) * (x1 - x0));
            data.extend(sum.iter().map(|s| (s / n) as u8));
        }
    }
    Rgb {
        width: w,
        height: h,
        data,
    }
}

fn encode(img: &Rgb) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut e = png::Encoder::new(&mut out, img.width, img.height);
    e.set_color(png::ColorType::Rgb);
    e.set_depth(png::BitDepth::Eight);
    e.set_compression(png::Compression::Fast);
    let mut w = e.write_header().map_err(|e| e.to_string())?;
    w.write_image_data(&img.data).map_err(|e| e.to_string())?;
    w.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

impl Guest for Ppm {
    fn thumbnail(_format: String, f: File, edge: u32) -> Result<Option<Thumbnail>, String> {
        let img = parse(&read_all(&f)?)?;
        let size = Dimensions {
            width: img.width,
            height: img.height,
        };
        Ok(Some(Thumbnail {
            png: encode(&shrink(&img, edge))?,
            size: Some(size),
        }))
    }

    fn view(_format: String, _f: File) -> Option<View> {
        Some(View::Decoded)
    }

    fn decode(_format: String, f: File) -> Result<Vec<u8>, String> {
        encode(&parse(&read_all(&f)?)?)
    }

    fn details(_format: String, _f: File) -> Result<Vec<Detail>, String> {
        Ok(Vec::new())
    }

    fn menu(_format: String, _f: File) -> Result<Vec<MenuItem>, String> {
        Ok(Vec::new())
    }

    fn run_menu(_format: String, _f: File, id: String) -> Result<Option<String>, String> {
        Err(format!("{id} には対応していません"))
    }

    fn settings() -> Vec<Setting> {
        Vec::new()
    }

    fn call(_format: String, _f: File, method: String, _args: String) -> Result<String, String> {
        Err(format!("{method} には対応していません"))
    }
}

export!(Ppm);
