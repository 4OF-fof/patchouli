//! PSD（と PSB）を読む。保存したときに入る合成画像だけを使い、レイヤーを重ねることはしない。

use crate::patchouli::plugin::host;
use crate::patchouli::plugin::types::File;

const CHUNK: usize = 1 << 20;

#[derive(Clone, Copy, PartialEq)]
pub enum Mode {
    Bitmap,
    Gray,
    Indexed,
    Rgb,
    Cmyk,
    Multichannel,
    Duotone,
    Lab,
}

impl Mode {
    pub fn label(self) -> &'static str {
        match self {
            Mode::Bitmap => "白黒 2 値",
            Mode::Gray => "グレースケール",
            Mode::Indexed => "インデックスカラー",
            Mode::Rgb => "RGB",
            Mode::Cmyk => "CMYK",
            Mode::Multichannel => "マルチチャンネル",
            Mode::Duotone => "ダブルトーン",
            Mode::Lab => "Lab",
        }
    }

    /// 合成画像の色に使うチャンネルの数。ほかは使わない。Lab などは明るさだけで灰色にする。
    fn colors(self) -> usize {
        match self {
            Mode::Rgb => 3,
            Mode::Cmyk => 4,
            _ => 1,
        }
    }
}

pub struct Psd {
    pub width: u32,
    pub height: u32,
    pub depth: u16,
    pub mode: Mode,
    pub layers: u32,
    channels: usize,
    /// 合成画像の 1 つ目のアルファチャンネルが、透明なところを表すか。
    alpha: bool,
    big: bool,
    palette: Vec<u8>,
    image: u64,
}

/// ファイルを少しずつ読む。
struct Reader<'a> {
    f: &'a File,
    buf: Vec<u8>,
    start: u64,
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(f: &'a File, pos: u64) -> Self {
        Reader {
            f,
            buf: Vec::new(),
            start: pos,
            at: 0,
        }
    }

    fn pos(&self) -> u64 {
        self.start + self.at as u64
    }

    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        if self.at + n > self.buf.len() {
            self.buf.drain(..self.at);
            self.start += self.at as u64;
            self.at = 0;
            while self.buf.len() < n {
                let from = self.start + self.buf.len() as u64;
                let want = (n - self.buf.len()).max(CHUNK) as u32;
                let part = host::read(self.f, from, want)?;
                if part.is_empty() {
                    return Err("PSD が途中で切れています".into());
                }
                self.buf.extend_from_slice(&part);
            }
        }
        let out = &self.buf[self.at..self.at + n];
        self.at += n;
        Ok(out)
    }

    fn seek(&mut self, pos: u64) {
        if pos >= self.start && pos <= self.start + self.buf.len() as u64 {
            self.at = (pos - self.start) as usize;
        } else {
            self.buf.clear();
            self.start = pos;
            self.at = 0;
        }
    }

    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_be_bytes(
            self.take(2)?.try_into().unwrap_or_default(),
        ))
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().unwrap_or_default(),
        ))
    }

    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().unwrap_or_default(),
        ))
    }

    /// PSB では 8 バイトになる長さ。
    fn len(&mut self, big: bool) -> Result<u64, String> {
        if big {
            self.u64()
        } else {
            self.u32().map(u64::from)
        }
    }
}

pub fn read(f: &File) -> Result<Psd, String> {
    let mut r = Reader::new(f, 0);
    if r.take(4)? != b"8BPS" {
        return Err("PSD ではないか、壊れています".into());
    }
    let big = match r.u16()? {
        1 => false,
        2 => true,
        v => return Err(format!("版 {v} の PSD には対応していません")),
    };
    r.take(6)?;
    let channels = usize::from(r.u16()?);
    let height = r.u32()?;
    let width = r.u32()?;
    let depth = r.u16()?;
    let mode = match r.u16()? {
        0 => Mode::Bitmap,
        1 => Mode::Gray,
        2 => Mode::Indexed,
        3 => Mode::Rgb,
        4 => Mode::Cmyk,
        7 => Mode::Multichannel,
        8 => Mode::Duotone,
        9 => Mode::Lab,
        m => return Err(format!("色の形式（{m}）に対応していません")),
    };
    if width == 0 || height == 0 || channels < mode.colors() {
        return Err("PSD の大きさかチャンネルの数が不正です".into());
    }
    if ![1, 8, 16, 32].contains(&depth) {
        return Err(format!("{depth} ビットの PSD には対応していません"));
    }
    let palette_len = u64::from(r.u32()?);
    let at = r.pos();
    let palette = if mode == Mode::Indexed && palette_len >= 768 {
        r.take(768)?.to_vec()
    } else {
        Vec::new()
    };
    r.seek(at + palette_len);
    let resources = u64::from(r.u32()?);
    r.seek(r.pos() + resources);
    let masks = r.len(big)?;
    let image = r.pos() + masks;
    let (layers, alpha) = if masks == 0 {
        (0, false)
    } else {
        layers(&mut r, big, image)?
    };
    Ok(Psd {
        width,
        height,
        depth,
        mode,
        layers,
        channels,
        alpha: alpha && channels > mode.colors(),
        big,
        palette,
        image,
    })
}

/// レイヤーの数と、合成画像に透明なところがあるか。16・32 ビットでは、レイヤーは追加の情報（Lr16・Lr32）に入る。
fn layers(r: &mut Reader, big: bool, end: u64) -> Result<(u32, bool), String> {
    let info = r.len(big)?;
    let after = r.pos() + info;
    if info >= 2 {
        let n = r.u16()? as i16;
        return Ok((u32::from(n.unsigned_abs()), n < 0));
    }
    r.seek(after);
    let global = u64::from(r.u32()?);
    r.seek(r.pos() + global);
    while r.pos() + 12 <= end {
        let sig = r.take(4)?.to_vec();
        if sig != b"8BIM" && sig != b"8B64" {
            break;
        }
        let key = r.take(4)?.to_vec();
        let wide = big
            && matches!(
                &key[..],
                b"Lr16"
                    | b"Lr32"
                    | b"Layr"
                    | b"Mt16"
                    | b"Mt32"
                    | b"Mtrn"
                    | b"Alph"
                    | b"FMsk"
                    | b"lnk2"
                    | b"FEid"
                    | b"FXid"
                    | b"PxSD"
            );
        let len = r.len(wide)?;
        let next = r.pos() + len;
        if matches!(&key[..], b"Lr16" | b"Lr32" | b"Layr") && len >= 2 {
            let n = r.u16()? as i16;
            return Ok((u32::from(n.unsigned_abs()), n < 0));
        }
        // 中身の長さは 4 の倍数にそろえてある
        r.seek(next + (4 - next % 4) % 4);
    }
    Ok((0, false))
}

/// 合成画像の 1 行（1 チャンネル分）を 8 ビットにする。
fn to8(depth: u16, row: &[u8], width: usize, out: &mut [u8]) {
    match depth {
        1 => {
            for (x, o) in out.iter_mut().enumerate().take(width) {
                *o = if row[x / 8] & (0x80 >> (x % 8)) != 0 {
                    0
                } else {
                    255
                };
            }
        }
        8 => out[..width].copy_from_slice(&row[..width]),
        16 => {
            for (o, s) in out.iter_mut().zip(row.chunks_exact(2)) {
                *o = s[0];
            }
        }
        _ => {
            // 32 ビットは光の強さそのままなので、見た目の明るさに直す
            for (o, s) in out.iter_mut().zip(row.chunks_exact(4)) {
                let v = f32::from_be_bytes([s[0], s[1], s[2], s[3]]).clamp(0.0, 1.0);
                *o = (v.powf(1.0 / 2.2) * 255.0).round() as u8;
            }
        }
    }
}

fn unpack(src: &[u8], out: &mut [u8]) {
    let (mut i, mut o) = (0, 0);
    while i < src.len() && o < out.len() {
        let n = src[i] as i8;
        i += 1;
        if n >= 0 {
            let len = (n as usize + 1).min(out.len() - o).min(src.len() - i);
            out[o..o + len].copy_from_slice(&src[i..i + len]);
            i += len;
            o += len;
        } else if n != -128 {
            let len = ((1 - n as isize) as usize).min(out.len() - o);
            if let Some(&v) = src.get(i) {
                out[o..o + len].fill(v);
            }
            i += 1;
            o += len;
        }
    }
}

/// 色に使うチャンネル（と透明なところ）を、out_w × out_h に縮めて、画素ごとに並べたもの。
/// 縮めるときは、元の画素を平均する。
struct Samples {
    width: usize,
    height: usize,
    count: usize,
    out_w: usize,
    out_h: usize,
    /// 縮めないときは 8 ビットの値、縮めるときは足し合わせた値。
    full: Vec<u8>,
    sums: Vec<u32>,
}

impl Samples {
    fn put(&mut self, ch: usize, y: usize, row: &[u8]) {
        if self.full.is_empty() {
            let oy = y * self.out_h / self.height;
            let base = oy * self.out_w;
            for (x, &v) in row.iter().enumerate() {
                let ox = x * self.out_w / self.width;
                self.sums[(base + ox) * self.count + ch] += u32::from(v);
            }
        } else {
            let base = y * self.width;
            for (x, &v) in row.iter().enumerate() {
                self.full[(base + x) * self.count + ch] = v;
            }
        }
    }

    fn finish(self) -> Vec<u8> {
        if !self.full.is_empty() {
            return self.full;
        }
        // 出す画素 1 つに入る元の画素の数は、列ごと・行ごとの数の積
        let per = |n: usize, out: usize| {
            let mut c = vec![0u32; out];
            for i in 0..n {
                c[i * out / n] += 1;
            }
            c
        };
        let (cols, rows) = (per(self.width, self.out_w), per(self.height, self.out_h));
        self.sums
            .iter()
            .enumerate()
            .map(|(i, &s)| {
                let p = i / self.count;
                let n = cols[p % self.out_w] * rows[p / self.out_w];
                (s / n.max(1)) as u8
            })
            .collect()
    }
}

pub struct Image {
    pub width: u32,
    pub height: u32,
    pub alpha: bool,
    /// RGB か RGBA の画素。
    pub pixels: Vec<u8>,
}

/// 合成画像を、長いほうの辺が edge 以下になるよう縮めて読む。edge が none なら元の大きさ。
pub fn image(f: &File, psd: &Psd, edge: Option<u32>) -> Result<Image, String> {
    let (w, h) = (psd.width as usize, psd.height as usize);
    let scale = edge.map_or(1.0, |e| (f64::from(e) / w.max(h) as f64).min(1.0));
    let (out_w, out_h) = (
        ((w as f64 * scale).round() as usize).max(1),
        ((h as f64 * scale).round() as usize).max(1),
    );
    let colors = psd.mode.colors();
    let count = colors + usize::from(psd.alpha);
    let full = out_w == w && out_h == h;
    let mut s = Samples {
        width: w,
        height: h,
        count,
        out_w,
        out_h,
        full: if full {
            vec![0; w * h * count]
        } else {
            Vec::new()
        },
        sums: if full {
            Vec::new()
        } else {
            vec![0; out_w * out_h * count]
        },
    };
    let row_bytes = match psd.depth {
        1 => w.div_ceil(8),
        d => w * usize::from(d / 8),
    };
    let mut r = Reader::new(f, psd.image);
    let compression = r.u16()?;
    let mut row = vec![0u8; row_bytes];
    let mut row8 = vec![0u8; w];
    match compression {
        0 => {
            for ch in 0..count {
                for y in 0..h {
                    row.copy_from_slice(r.take(row_bytes)?);
                    to8(psd.depth, &row, w, &mut row8);
                    s.put(ch, y, &row8);
                }
            }
        }
        1 => {
            // 先に、行ごとの圧縮後の長さが全チャンネル分ならぶ
            let mut lens = Vec::with_capacity(psd.channels * h);
            for _ in 0..psd.channels * h {
                lens.push(if psd.big {
                    r.u32()? as usize
                } else {
                    usize::from(r.u16()?)
                });
            }
            for ch in 0..count {
                for y in 0..h {
                    unpack(r.take(lens[ch * h + y])?, &mut row);
                    to8(psd.depth, &row, w, &mut row8);
                    s.put(ch, y, &row8);
                }
            }
        }
        c => return Err(format!("合成画像の圧縮（{c}）に対応していません")),
    }
    let samples = s.finish();
    let pixels = to_rgb(psd, &samples, count);
    Ok(Image {
        width: out_w as u32,
        height: out_h as u32,
        alpha: psd.alpha,
        pixels,
    })
}

fn to_rgb(psd: &Psd, samples: &[u8], count: usize) -> Vec<u8> {
    let out = 3 + usize::from(psd.alpha);
    let mut px = Vec::with_capacity(samples.len() / count * out);
    for s in samples.chunks_exact(count) {
        let rgb = match psd.mode {
            Mode::Rgb => [s[0], s[1], s[2]],
            // 白いところが 255 で入っているので、インクの少なさとして掛け合わせる
            Mode::Cmyk => {
                let k = u16::from(s[3]);
                [0, 1, 2].map(|i| (u16::from(s[i]) * k / 255) as u8)
            }
            Mode::Indexed if psd.palette.len() >= 768 => {
                let i = usize::from(s[0]);
                [psd.palette[i], psd.palette[256 + i], psd.palette[512 + i]]
            }
            _ => [s[0]; 3],
        };
        px.extend_from_slice(&rgb);
        if psd.alpha {
            px.push(s[count - 1]);
        }
    }
    px
}
