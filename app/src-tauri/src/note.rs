use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    #[serde(rename = "type")]
    pub kind: BlockKind,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    P,
    H2,
    Li,
}

pub struct NoteText<'a> {
    pub front: Option<&'a str>,
    pub body: &'a str,
}

pub fn split(text: &str) -> NoteText<'_> {
    let none = NoteText {
        front: None,
        body: text,
    };
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return none;
    };
    let mut at = 0;
    for line in rest.split_inclusive('\n') {
        let t = line.trim_end_matches(['\r', '\n']);
        if t == "---" || t == "..." {
            return NoteText {
                front: Some(&rest[..at]),
                body: &rest[at + line.len()..],
            };
        }
        at += line.len();
    }
    none
}

pub fn front_values(front: Option<&str>) -> Result<Value, String> {
    match front {
        None => Ok(Value::Null),
        Some(f) if f.trim().is_empty() => Ok(Value::Null),
        Some(f) => serde_yaml_ng::from_str(f)
            .map_err(|e| format!("frontmatter の読み込みに失敗しました：{e}")),
    }
}

pub fn str_of(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn list_of(v: &Value, key: &str) -> Vec<String> {
    match v.get(key) {
        Some(Value::Sequence(s)) => s
            .iter()
            .filter_map(|x| x.as_str().map(str::to_owned))
            .collect(),
        Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
        _ => vec![],
    }
}

pub fn set_key(front: &str, key: &str, value: &serde_json::Value) -> String {
    let line = format!("{key}: {value}");
    let lines: Vec<&str> = front.lines().collect();
    let head = format!("{key}:");
    let Some(i) = lines.iter().position(|l| l.starts_with(&head)) else {
        let mut out = front.to_owned();
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&line);
        out.push('\n');
        return out;
    };
    // 値が次の行に続く（字下げした行や「- 」で始まる行）ときは、そこまでを 1 つの値とみる
    let mut j = i + 1;
    while j < lines.len() && (lines[j].starts_with([' ', '\t', '-']) || lines[j].is_empty()) {
        j += 1;
    }
    while j > i + 1 && lines[j - 1].is_empty() {
        j -= 1;
    }
    let mut out: Vec<&str> = lines[..i].to_vec();
    out.push(&line);
    out.extend_from_slice(&lines[j..]);
    out.join("\n") + "\n"
}

pub fn join(front: &str, body: &str) -> String {
    format!("---\n{front}---\n{body}")
}

pub fn blocks_of(body: &str) -> Vec<Block> {
    let mut out = Vec::new();
    let mut cur: Option<Block> = None;
    let flush = |cur: &mut Option<Block>, out: &mut Vec<Block>| {
        if let Some(mut b) = cur.take() {
            b.text = b.text.trim().to_owned();
            if !b.text.is_empty() {
                out.push(b);
            }
        }
    };
    let start = |cur: &mut Option<Block>, kind| {
        *cur = Some(Block {
            kind,
            text: String::new(),
        })
    };
    for ev in Parser::new(body) {
        match ev {
            Event::Start(Tag::Heading { .. }) => {
                flush(&mut cur, &mut out);
                start(&mut cur, BlockKind::H2);
            }
            Event::Start(Tag::Item) => {
                flush(&mut cur, &mut out);
                start(&mut cur, BlockKind::Li);
            }
            Event::Start(Tag::Paragraph | Tag::CodeBlock(_)) if cur.is_none() => {
                start(&mut cur, BlockKind::P)
            }
            Event::End(
                TagEnd::Heading(_) | TagEnd::Paragraph | TagEnd::Item | TagEnd::CodeBlock,
            ) => flush(&mut cur, &mut out),
            Event::Text(t) | Event::Code(t) => {
                if let Some(b) = cur.as_mut() {
                    b.text.push_str(&t);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(b) = cur.as_mut() {
                    b.text.push(' ');
                }
            }
            _ => {}
        }
    }
    flush(&mut cur, &mut out);
    out
}

pub fn body_of(blocks: &[Block]) -> String {
    let mut body = String::new();
    let mut prev = None;
    for b in blocks {
        if !body.is_empty() {
            body.push_str(if b.kind == BlockKind::Li && prev == Some(BlockKind::Li) {
                "\n"
            } else {
                "\n\n"
            });
        }
        match b.kind {
            BlockKind::H2 => body.push_str("## "),
            BlockKind::Li => body.push_str("- "),
            BlockKind::P => {}
        }
        body.push_str(&b.text);
        prev = Some(b.kind);
    }
    format!("\n{body}\n")
}
