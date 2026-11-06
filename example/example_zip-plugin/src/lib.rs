//! zip のサムネイルにアイコンを描き、詳細では中身の一覧を elevated（ui.ts）に渡す。
//! 一覧は call の entries で、中央ディレクトリだけを読んで作る。中身を展開することはしない。

wit_bindgen::generate!({
    inline: "
        package local:zip;

        world zip {
            include patchouli:plugin/thumbnail-role@0.13.0;
            include patchouli:plugin/call-role@0.13.0;
        }
    ",
    path: "../../app/plugins/sdk/wit",
    world: "local:zip/zip",
    generate_all,
});

mod icon;

use exports::patchouli::plugin as role;
use patchouli::plugin::host;
use patchouli::plugin::types::{File, ThumbnailImage};
use serde_json::json;

const END: u32 = 0x0605_4b50;
const END64: u32 = 0x0606_4b50;
const LOCATOR64: u32 = 0x0706_4b50;
const ENTRY: u32 = 0x0201_4b50;
/// 終わりの記録（22 バイト）と、そのあとに付くコメントの最大の長さ。
const TAIL: u64 = 22 + 0xffff;
/// これより大きい中央ディレクトリは読まない。
const MAX_DIRECTORY: u64 = 64 << 20;
const CHUNK: u64 = 1 << 20;

struct Zip;

impl role::thumbnail::Guest for Zip {
    fn thumbnail(_format: String, _f: File, edge: u32) -> Result<Option<ThumbnailImage>, String> {
        Ok(Some(ThumbnailImage {
            png: icon::draw(edge)?,
            size: None,
        }))
    }
}

impl role::call::Guest for Zip {
    /// entries：{ entries: [{ path, size }], packed }。フォルダは path が / で終わる。packed は圧縮後の大きさの合計。
    fn call(_format: String, f: File, method: String, _args: String) -> Result<String, String> {
        if method != "entries" {
            return Err(format!("{method} という呼び出しはありません"));
        }
        let entries = entries(&f)?;
        let packed: u64 = entries.iter().map(|e| e.packed).sum();
        let list: Vec<_> = entries
            .iter()
            .map(|e| json!({ "path": e.path, "size": e.size }))
            .collect();
        Ok(json!({ "entries": list, "packed": packed }).to_string())
    }
}

struct Entry {
    path: String,
    size: u64,
    packed: u64,
}

fn read(f: &File, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut buf = Vec::with_capacity(len as usize);
    while (buf.len() as u64) < len {
        let want = (len - buf.len() as u64).min(CHUNK) as u32;
        let part = host::read(f, offset + buf.len() as u64, want)?;
        if part.is_empty() {
            break;
        }
        buf.extend_from_slice(&part);
    }
    if (buf.len() as u64) < len {
        return Err("zip が途中で切れています".into());
    }
    Ok(buf)
}

fn u16_at(b: &[u8], at: usize) -> u64 {
    u64::from(u16::from_le_bytes([b[at], b[at + 1]]))
}

fn u32_at(b: &[u8], at: usize) -> u64 {
    u64::from(u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]))
}

fn u64_at(b: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(b[at..at + 8].try_into().unwrap_or_default())
}

/// 中央ディレクトリの場所（offset・大きさ）。
fn directory(f: &File) -> Result<(u64, u64), String> {
    let start = f.size.saturating_sub(TAIL);
    let tail = read(f, start, f.size - start)?;
    let at = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&i| u32_at(&tail, i) == u64::from(END))
        .ok_or("zip ではないか、壊れています")?;
    let (size, offset) = (u32_at(&tail, at + 12), u32_at(&tail, at + 16));
    if size != 0xffff_ffff && offset != 0xffff_ffff {
        return Ok((offset, size));
    }
    // ZIP64 は、終わりの記録の前に、ZIP64 の終わりの記録の場所が書いてある
    let locator = (start + at as u64)
        .checked_sub(20)
        .ok_or("ZIP64 の記録が見つかりません")?;
    let loc = read(f, locator, 20)?;
    if u32_at(&loc, 0) != u64::from(LOCATOR64) {
        return Err("ZIP64 の記録が見つかりません".into());
    }
    let end = read(f, u64_at(&loc, 8), 56)?;
    if u32_at(&end, 0) != u64::from(END64) {
        return Err("ZIP64 の記録が壊れています".into());
    }
    Ok((u64_at(&end, 48), u64_at(&end, 40)))
}

fn entries(f: &File) -> Result<Vec<Entry>, String> {
    let (offset, size) = directory(f)?;
    if size > MAX_DIRECTORY {
        return Err("中身が多すぎて読めません".into());
    }
    let d = read(f, offset, size)?;
    let mut out = Vec::new();
    let mut at = 0;
    while at + 46 <= d.len() && u32_at(&d, at) == u64::from(ENTRY) {
        let flags = u16_at(&d, at + 8);
        let mut packed = u32_at(&d, at + 20);
        let mut size = u32_at(&d, at + 24);
        let name_len = u16_at(&d, at + 28) as usize;
        let extra_len = u16_at(&d, at + 30) as usize;
        let comment_len = u16_at(&d, at + 32) as usize;
        let name_at = at + 46;
        let extra_at = name_at + name_len;
        let next = extra_at + extra_len + comment_len;
        if next > d.len() {
            return Err("zip の目次が壊れています".into());
        }
        let raw = &d[name_at..extra_at];
        let mut unicode = None;
        for (id, data) in extras(&d[extra_at..extra_at + extra_len]) {
            match id {
                // ZIP64：32 ビットに収まらない大きさが、元の大きさ・圧縮後の大きさの順に入る
                0x0001 => {
                    let mut i = 0;
                    if size == 0xffff_ffff && data.len() >= i + 8 {
                        size = u64_at(data, i);
                        i += 8;
                    }
                    if packed == 0xffff_ffff && data.len() >= i + 8 {
                        packed = u64_at(data, i);
                    }
                }
                // UTF-8 の名前（版・元の名前の CRC のあとに続く）
                0x7075 if data.len() > 5 => unicode = std::str::from_utf8(&data[5..]).ok(),
                _ => {}
            }
        }
        let path = match unicode {
            Some(s) if flags & 0x0800 == 0 => s.to_owned(),
            _ => String::from_utf8_lossy(raw).into_owned(),
        };
        out.push(Entry {
            path: path.replace('\\', "/"),
            size,
            packed,
        });
        at = next;
    }
    Ok(out)
}

/// 拡張フィールドの（ID・中身）の並び。
fn extras(b: &[u8]) -> impl Iterator<Item = (u64, &[u8])> {
    let mut at = 0;
    std::iter::from_fn(move || {
        if at + 4 > b.len() {
            return None;
        }
        let id = u16_at(b, at);
        let end = (at + 4 + u16_at(b, at + 2) as usize).min(b.len());
        let data = &b[at + 4..end];
        at = end;
        Some((id, data))
    })
}

export!(Zip);
