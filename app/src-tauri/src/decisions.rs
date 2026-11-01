//! 整理で承認したタグと外したタグ。ライブラリの .patchouli/tag-decisions/<端末の ID>.jsonl に端末ごとに残して同期する。
//! 書き足すだけで、元に戻すときは取り消しの行を足す。

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::library::STATE_DIR;

const DIR: &str = "tag-decisions";

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum Line {
    /// tag を付けた（ok）か、外したか
    Decide { item: String, tag: String, ok: bool },
    /// 同じファイルにある item の判断を、すべて取り消す
    Undo { item: String, undo: bool },
}

pub struct Decision {
    pub item: String,
    pub tag: String,
    pub ok: bool,
}

fn dir(root: &Path) -> PathBuf {
    root.join(STATE_DIR).join(DIR)
}

fn append(root: &Path, device: &str, lines: &[Line]) -> Result<(), String> {
    let d = dir(root);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(d.join(format!("{device}.jsonl")))
        .map_err(|e| e.to_string())?;
    let mut text = String::new();
    for l in lines {
        text.push_str(&serde_json::to_string(l).map_err(|e| e.to_string())?);
        text.push('\n');
    }
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

pub fn record(
    root: &Path,
    device: &str,
    item: &str,
    chosen: &[String],
    rejected: &[String],
) -> Result<(), String> {
    let lines: Vec<Line> = chosen
        .iter()
        .map(|t| (t, true))
        .chain(rejected.iter().map(|t| (t, false)))
        .map(|(tag, ok)| Line::Decide {
            item: item.to_owned(),
            tag: tag.clone(),
            ok,
        })
        .collect();
    append(root, device, &lines)
}

pub fn undo(root: &Path, device: &str, item: &str) -> Result<(), String> {
    append(
        root,
        device,
        &[Line::Undo {
            item: item.to_owned(),
            undo: true,
        }],
    )
}

/// すべての端末の判断を、取り消しを引いて読む。読めない行は飛ばす。
pub fn load(root: &Path) -> Vec<Decision> {
    let Ok(rd) = std::fs::read_dir(dir(root)) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for e in rd.filter_map(Result::ok) {
        if e.path().extension().is_none_or(|x| x != "jsonl") {
            continue;
        }
        let text = std::fs::read_to_string(e.path()).unwrap_or_default();
        let mut kept: HashMap<String, Vec<(String, bool)>> = HashMap::new();
        for l in text.lines() {
            match serde_json::from_str::<Line>(l) {
                Ok(Line::Decide { item, tag, ok }) => kept.entry(item).or_default().push((tag, ok)),
                Ok(Line::Undo { item, .. }) => {
                    kept.remove(&item);
                }
                Err(_) => {}
            }
        }
        out.extend(kept.into_iter().flat_map(|(item, ds)| {
            ds.into_iter().map(move |(tag, ok)| Decision {
                item: item.clone(),
                tag,
                ok,
            })
        }));
    }
    out
}
