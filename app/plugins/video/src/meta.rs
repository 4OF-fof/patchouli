use crate::File;
use crate::patchouli::plugin::host;
use crate::probe::Probe;

/// 入れ物（mp4・mov・m4v は ISO BMFF、webm は Matroska）の頭を読んで、映像の大きさと長さを拾う。
pub fn meta(f: &File) -> Option<Probe> {
    let head = at(f, 0, 4)?;
    let p = if head == [0x1a, 0x45, 0xdf, 0xa3] {
        matroska(f)
    } else {
        bmff(f)
    };
    p.filter(|p| p.size.is_some() || p.secs.is_some())
}

fn at(f: &File, offset: u64, len: u32) -> Option<Vec<u8>> {
    let b = host::read(f, offset, len).ok()?;
    (b.len() == len as usize).then_some(b)
}

fn be(b: &[u8]) -> u64 {
    b.iter().fold(0, |n, &x| (n << 8) | u64::from(x))
}

/// ISO BMFF の箱。中身の始まりと終わり。
struct Bx {
    kind: [u8; 4],
    body: u64,
    end: u64,
}

fn boxes(f: &File, from: u64, to: u64) -> Vec<Bx> {
    let mut out = Vec::new();
    let mut pos = from;
    while pos + 8 <= to {
        let Some(h) = at(f, pos, 8) else { break };
        let kind = [h[4], h[5], h[6], h[7]];
        let (size, head) = match be(&h[..4]) {
            1 => match at(f, pos + 8, 8) {
                Some(l) => (be(&l), 16),
                None => break,
            },
            0 => (to - pos, 8),
            n => (n, 8),
        };
        if size < head {
            break;
        }
        let end = (pos + size).min(to);
        out.push(Bx {
            kind,
            body: pos + head,
            end,
        });
        pos = end;
    }
    out
}

fn child<'a>(bs: &'a [Bx], kind: &[u8; 4]) -> Option<&'a Bx> {
    bs.iter().find(|b| &b.kind == kind)
}

fn bmff(f: &File) -> Option<Probe> {
    let top = boxes(f, 0, f.size);
    let moov = child(&top, b"moov")?;
    let inner = boxes(f, moov.body, moov.end);
    let secs = child(&inner, b"mvhd").and_then(|b| mvhd(f, b));
    let size = inner
        .iter()
        .filter(|b| &b.kind == b"trak")
        .find_map(|t| child(&boxes(f, t.body, t.end), b"tkhd").and_then(|b| tkhd(f, b)));
    Some(Probe { size, secs })
}

fn mvhd(f: &File, b: &Bx) -> Option<f64> {
    let v = at(f, b.body, 1)?[0];
    let (scale, dur) = if v == 1 {
        let d = at(f, b.body + 20, 12)?;
        (be(&d[..4]), be(&d[4..]))
    } else {
        let d = at(f, b.body + 12, 8)?;
        (be(&d[..4]), be(&d[4..]))
    };
    // 長さがわからないときは、すべてのビットが立っている
    let unknown = if v == 1 { u64::MAX } else { u64::from(u32::MAX) };
    (scale > 0 && dur > 0 && dur != unknown).then(|| dur as f64 / scale as f64)
}

/// 映像の入っていないトラックは、大きさが 0。向きの行列が 90 度か 270 度なら、縦横を入れ替える。
fn tkhd(f: &File, b: &Bx) -> Option<(u32, u32)> {
    let v = at(f, b.body, 1)?[0];
    let rest = b.body + if v == 1 { 4 + 32 } else { 4 + 20 } + 8 + 8;
    let d = at(f, rest, 44)?;
    let m = |i: usize| be(&d[i * 4..i * 4 + 4]) as u32 as i32;
    let (w, h) = (m(9) as u32 >> 16, m(10) as u32 >> 16);
    if w == 0 || h == 0 {
        return None;
    }
    let turned = m(0) == 0 && m(4) == 0 && m(1) != 0 && m(3) != 0;
    Some(if turned { (h, w) } else { (w, h) })
}

const SEGMENT: u64 = 0x1853_8067;
const INFO: u64 = 0x1549_a966;
const TRACKS: u64 = 0x1654_ae6b;
const CLUSTER: u64 = 0x1f43_b675;
const TIMESTAMP_SCALE: u64 = 0x2a_d7b1;
const DURATION: u64 = 0x4489;
const TRACK_ENTRY: u64 = 0xae;
const TRACK_TYPE: u64 = 0x83;
const VIDEO: u64 = 0xe0;
const PIXEL_WIDTH: u64 = 0xb0;
const PIXEL_HEIGHT: u64 = 0xba;

/// Matroska の要素。大きさがわからないもの（録りながら書いたもの）は end がファイルの終わり。
struct El {
    id: u64,
    body: u64,
    end: u64,
}

fn vint(b: &[u8], keep: bool) -> Option<(u64, usize, bool)> {
    let first = *b.first()?;
    let len = first.leading_zeros() as usize + 1;
    if len > 8 || b.len() < len {
        return None;
    }
    let mask = if keep {
        0xff
    } else {
        0xffu8.checked_shr(len as u32).unwrap_or(0)
    };
    let v = b[1..len]
        .iter()
        .fold(u64::from(first & mask), |n, &x| (n << 8) | u64::from(x));
    let all = (1u64 << (7 * len)) - 1;
    Some((v, len, !keep && v == all))
}

fn element(f: &File, pos: u64, to: u64) -> Option<El> {
    let h = host::read(f, pos, 12).ok()?;
    let (id, a, _) = vint(&h, true)?;
    let (size, b, unknown) = vint(&h[a..], false)?;
    let body = pos + (a + b) as u64;
    let end = if unknown { to } else { (body + size).min(to) };
    Some(El { id, body, end })
}

fn elements(f: &File, from: u64, to: u64, mut each: impl FnMut(&El) -> bool) {
    let mut pos = from;
    while pos < to {
        let Some(e) = element(f, pos, to) else { break };
        if !each(&e) || e.end <= pos {
            break;
        }
        pos = e.end;
    }
}

fn body(f: &File, e: &El) -> Option<Vec<u8>> {
    let len = u32::try_from(e.end - e.body).ok().filter(|&n| n <= 8)?;
    at(f, e.body, len)
}

fn matroska(f: &File) -> Option<Probe> {
    let mut seg = None;
    elements(f, 0, f.size, |e| {
        if e.id == SEGMENT {
            seg = Some((e.body, e.end));
        }
        seg.is_none()
    });
    let (from, to) = seg?;
    let (mut secs, mut size) = (None, None);
    elements(f, from, to, |e| {
        match e.id {
            INFO => secs = info(f, e),
            TRACKS => size = tracks(f, e),
            CLUSTER => return false,
            _ => {}
        }
        secs.is_none() || size.is_none()
    });
    Some(Probe { size, secs })
}

fn info(f: &File, info: &El) -> Option<f64> {
    let (mut scale, mut dur) = (1_000_000u64, None);
    elements(f, info.body, info.end, |e| {
        match e.id {
            TIMESTAMP_SCALE => scale = body(f, e).map_or(scale, |b| be(&b)),
            DURATION => {
                dur = body(f, e).and_then(|b| match b.len() {
                    4 => Some(f64::from(f32::from_be_bytes(b.try_into().ok()?))),
                    8 => Some(f64::from_be_bytes(b.try_into().ok()?)),
                    _ => None,
                });
            }
            _ => {}
        }
        true
    });
    dur.filter(|d| *d > 0.0).map(|d| d * scale as f64 / 1e9)
}

fn tracks(f: &File, tracks: &El) -> Option<(u32, u32)> {
    let mut found = None;
    elements(f, tracks.body, tracks.end, |t| {
        if t.id == TRACK_ENTRY {
            found = track(f, t);
        }
        found.is_none()
    });
    found
}

fn track(f: &File, t: &El) -> Option<(u32, u32)> {
    let (mut video, mut w, mut h) = (false, 0, 0);
    elements(f, t.body, t.end, |e| {
        match e.id {
            TRACK_TYPE => video = body(f, e).is_some_and(|b| be(&b) == 1),
            VIDEO => elements(f, e.body, e.end, |v| {
                let n = || body(f, v).map_or(0, |b| be(&b) as u32);
                match v.id {
                    PIXEL_WIDTH => w = n(),
                    PIXEL_HEIGHT => h = n(),
                    _ => {}
                }
                true
            }),
            _ => {}
        }
        true
    });
    (video && w > 0 && h > 0).then_some((w, h))
}
