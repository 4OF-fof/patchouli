//! インターネットショートカット（.url）が指す URL。INI の [InternetShortcut] の URL= を読み、http か https のものだけを返す。
//! Windows が書くものは、UTF-8 のほか、UTF-16 や、その端末の文字コード（日本語なら Shift_JIS）のこともある。

use std::borrow::Cow;
use std::io::Read;
use std::path::Path;

use encoding_rs::{Encoding, SHIFT_JIS, UTF_8, UTF_16BE, UTF_16LE};

pub const EXT: &str = "url";
pub const LABEL: &str = "ショートカット";
pub const RATIO: f64 = 1.91;

/// URL を書く行は頭のほうにあるので、それより後ろは読まない。
const HEAD: u64 = 64 << 10;

const SECTION: &str = "[InternetShortcut]";

pub fn url_of(path: &Path) -> Option<String> {
    let mut b = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(HEAD)
        .read_to_end(&mut b)
        .ok()?;
    parse(&decode(&b).0)
}

pub fn content(url: &str) -> String {
    format!("{SECTION}\r\nURL={url}\r\n")
}

/// old のリンク先を url に書き換えたもの。ほかの行（アイコンなど）と文字コードは残す。
pub fn with_url(old: &[u8], url: &str) -> Result<Vec<u8>, String> {
    if !web(url) {
        return Err("URL には http または https で始まる URL を入力してください".into());
    }
    let (text, enc) = decode(old);
    let nl = if text.contains("\r\n") || text.is_empty() {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let (mut section, mut at, mut inside) = (None, None, false);
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.starts_with('[') {
            inside = t.eq_ignore_ascii_case(SECTION);
            if inside && section.is_none() {
                section = Some(i);
            }
        } else if inside
            && t.split_once('=')
                .is_some_and(|(k, _)| k.trim_end().eq_ignore_ascii_case("url"))
        {
            at = Some(i);
            break;
        }
    }
    let line = format!("URL={url}");
    match (section, at) {
        (_, Some(i)) => lines[i] = line,
        (Some(s), None) => lines.insert(s + 1, line),
        (None, None) => {
            lines.insert(0, line);
            lines.insert(0, SECTION.to_owned());
        }
    }
    Ok(encode(&(lines.join(nl) + nl), enc))
}

fn decode(b: &[u8]) -> (Cow<'_, str>, &'static Encoding) {
    let (text, enc, bad) = UTF_8.decode(b);
    if bad {
        (SHIFT_JIS.decode(b).0, SHIFT_JIS)
    } else {
        (text, enc)
    }
}

/// encoding_rs は UTF-16 へは書けないので、UTF-16 は自分で BOM を付けて書く
fn encode(text: &str, enc: &'static Encoding) -> Vec<u8> {
    let units = || text.encode_utf16();
    if enc == UTF_16LE {
        [0xFF, 0xFE]
            .into_iter()
            .chain(units().flat_map(u16::to_le_bytes))
            .collect()
    } else if enc == UTF_16BE {
        [0xFE, 0xFF]
            .into_iter()
            .chain(units().flat_map(u16::to_be_bytes))
            .collect()
    } else {
        enc.encode(text).0.into_owned()
    }
}

fn web(v: &str) -> bool {
    ["http://", "https://"].iter().any(|s| {
        v.get(..s.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(s))
    })
}

fn parse(text: &str) -> Option<String> {
    let mut inside = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            inside = line.eq_ignore_ascii_case(SECTION);
        } else if inside
            && let Some((k, v)) = line.split_once('=')
            && k.trim_end().eq_ignore_ascii_case("url")
        {
            let v = v.trim();
            return web(v).then(|| v.to_owned());
        }
    }
    None
}
