//! インターネットショートカット（.url）が指す URL。INI の [InternetShortcut] の URL= を読み、http か https のものだけを返す。
//! Windows が書くものは、UTF-8 のほか、UTF-16 や、その端末の文字コード（日本語なら Shift_JIS）のこともある。

use std::io::Read;
use std::path::Path;

pub const EXT: &str = "url";
pub const LABEL: &str = "ショートカット";
pub const RATIO: f64 = 1.91;

/// URL を書く行は頭のほうにあるので、それより後ろは読まない。
const HEAD: u64 = 64 << 10;

pub fn url_of(path: &Path) -> Option<String> {
    let mut b = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(HEAD)
        .read_to_end(&mut b)
        .ok()?;
    let (text, _, bad) = encoding_rs::UTF_8.decode(&b);
    if bad {
        parse(&encoding_rs::SHIFT_JIS.decode(&b).0)
    } else {
        parse(&text)
    }
}

fn parse(text: &str) -> Option<String> {
    let mut inside = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            inside = line.eq_ignore_ascii_case("[internetshortcut]");
        } else if inside
            && let Some((k, v)) = line.split_once('=')
            && k.trim_end().eq_ignore_ascii_case("url")
        {
            let v = v.trim();
            let web = ["http://", "https://"].iter().any(|s| {
                v.get(..s.len())
                    .is_some_and(|head| head.eq_ignore_ascii_case(s))
            });
            return web.then(|| v.to_owned());
        }
    }
    None
}
