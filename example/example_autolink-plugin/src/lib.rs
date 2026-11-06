//! 取り込んだノートの本文に出てくるノートの名前のうち、内容の近いものを、そのノートへのリンクにする。
//! 近いノートは embed の similar で探す。自分の ID を知るのに library、本文を書き換えるのに notes を使う。

wit_bindgen::generate!({
    inline: "
        package local:autolink;

        world autolink {
            include patchouli:plugin/hook-role@0.13.0;
        }
    ",
    path: "../../app/plugins/sdk/wit",
    world: "local:autolink/autolink",
    generate_all,
});

use std::ops::Range;

use exports::patchouli::plugin as role;
use patchouli::plugin::types::{File, Read, Run, Target};
use patchouli::plugin::{embed, host, library, notes};

/// 本文と比べて、これより近いノートだけをリンクにする。
const MIN_SCORE: f32 = 0.2;
const CANDIDATES: u32 = 30;
/// これより短い名前は、ほかの語の一部に当たりやすいので使わない。
const MIN_NAME: usize = 2;
const CHUNK: u32 = 1 << 20;

struct Autolink;

impl role::hook::Guest for Autolink {
    fn added(read: &Read, run: &Run, target: Target) -> Result<(), String> {
        if !embed::available() {
            return Err("AI 機能を有効にしてモデルを入れると、リンクを付けられます".into());
        }
        let me = library::item(read, &target.file)?;
        let text = read_all(&target.file)?;
        let body = body_of(&text);
        if body.trim().is_empty() {
            return Ok(());
        }
        let mut out = body.to_owned();
        let mut linked = 0;
        for s in embed::similar(read, body, CANDIDATES)? {
            let it = s.info;
            if !it.note || it.id == me.id || s.score < MIN_SCORE {
                continue;
            }
            if it.name.chars().count() >= MIN_NAME && link_first(&mut out, &it.name, &it.id) {
                linked += 1;
            }
        }
        if linked > 0 {
            notes::set_body(run, &target.file, &out)?;
            host::log(&format!("「{}」に {linked} 件のリンクを付けた", me.name));
        }
        Ok(())
    }
}

fn read_all(f: &File) -> Result<String, String> {
    let mut buf = Vec::new();
    while (buf.len() as u64) < f.size {
        let part = host::read(f, buf.len() as u64, CHUNK)?;
        if part.is_empty() {
            break;
        }
        buf.extend_from_slice(&part);
    }
    String::from_utf8(buf).map_err(|_| "本文が UTF-8 ではありません".into())
}

/// 先頭のメタ情報（--- で囲んだところ）を除いた本文。
fn body_of(text: &str) -> &str {
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return text;
    };
    let mut at = 0;
    for line in rest.split_inclusive('\n') {
        let t = line.trim_end_matches(['\r', '\n']);
        if t == "---" || t == "..." {
            return &rest[at + line.len()..];
        }
        at += line.len();
    }
    text
}

/// リンク・インラインのコード・コードブロック・見出しの外で最初に出てくる name を、リンクにする。
fn link_first(body: &mut String, name: &str, id: &str) -> bool {
    let kept = protected(body);
    let found = body.match_indices(name).map(|(i, _)| i).find(|&i| {
        let end = i + name.len();
        bounded(body, i, end) && !kept.iter().any(|r| r.start < end && i < r.end)
    });
    let Some(i) = found else {
        return false;
    };
    body.replace_range(
        i..i + name.len(),
        &format!("[{}](patchouli:{id})", escape(name)),
    );
    true
}

/// 英数字の名前は、前後が英数字でないときだけ当てる。
fn bounded(body: &str, start: usize, end: usize) -> bool {
    let word = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
    let first = body[start..end].chars().next();
    let last = body[start..end].chars().next_back();
    !(word(first) && word(body[..start].chars().next_back()))
        && !(word(last) && word(body[end..].chars().next()))
}

/// 書き換えない範囲。
fn protected(body: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut fenced = false;
    let mut at = 0;
    for line in body.split_inclusive('\n') {
        let range = at..at + line.len();
        at += line.len();
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fenced = !fenced;
            out.push(range);
        } else if fenced || t.starts_with('#') {
            out.push(range);
        } else {
            out.extend(
                spans(line)
                    .into_iter()
                    .map(|r| r.start + range.start..r.end + range.start),
            );
        }
    }
    out
}

/// 1 行の中の、インラインのコードとリンク（[..](..)）の範囲。
fn spans(line: &str) -> Vec<Range<usize>> {
    let b = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'`' => {
                let end = line[i + 1..].find('`').map_or(b.len(), |j| i + 2 + j);
                out.push(i..end);
                i = end;
            }
            b'[' => match link_end(line, i) {
                Some(end) => {
                    out.push(i..end);
                    i = end;
                }
                None => i += 1,
            },
            _ => i += 1,
        }
    }
    out
}

/// [ から始まるリンクの終わり。
fn link_end(line: &str, open: usize) -> Option<usize> {
    let b = line.as_bytes();
    let mut i = open + 1;
    while i < b.len() && b[i] != b']' {
        i += if b[i] == b'\\' { 2 } else { 1 };
    }
    if b.get(i + 1) != Some(&b'(') {
        return None;
    }
    line[i + 2..].find(')').map(|j| i + 3 + j)
}

fn escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '\\' | '[' | ']' => vec!['\\', c],
            _ => vec![c],
        })
        .collect()
}

export!(Autolink);
