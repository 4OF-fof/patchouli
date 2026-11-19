use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde_json::{Value, json};

use crate::library::{check_name, mtime_of, read_json, write_file, write_json};

pub const LAYOUT: &str = "layout.json";
const DESC: &str = "desc";

/// 概要のカードを並びの順に読む。説明は `{id}.md`、ほかは `{id}.json` に 1 枚ずつあり、
/// ファイルのないカード（タグの kids など）は、並びに書いた id をそのまま種類とする。
pub fn read(dir: &Path, problems: &mut Vec<String>) -> (Value, f64) {
    let layout = dir.join(LAYOUT);
    let ids: Vec<String> = match fs::read_to_string(&layout) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(ids) => ids,
            Err(e) => {
                problems.push(format!("{}: {e}", layout.display()));
                return (json!([]), 0.0);
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (json!([]), 0.0),
        Err(e) => {
            problems.push(format!("{}: {e}", layout.display()));
            return (json!([]), 0.0);
        }
    };
    let mut mtime = mtime_of(&layout);
    let mut cards = Vec::new();
    for id in ids {
        if let Err(e) = check_name(&id) {
            problems.push(format!("{}: {e}", layout.display()));
            continue;
        }
        let md = dir.join(format!("{id}.md"));
        let js = dir.join(format!("{id}.json"));
        let card = if md.is_file() {
            match fs::read_to_string(&md) {
                Ok(text) => {
                    mtime = mtime.max(mtime_of(&md));
                    json!({ "id": id, "type": DESC, "text": text })
                }
                Err(e) => {
                    problems.push(format!("{}: {e}", md.display()));
                    continue;
                }
            }
        } else {
            match read_json(&js) {
                Ok(Some(mut m)) => {
                    mtime = mtime.max(mtime_of(&js));
                    m.insert("id".into(), json!(id));
                    Value::Object(m)
                }
                Ok(None) => json!({ "id": id, "type": id }),
                Err(e) => {
                    problems.push(format!("{}: {e}", js.display()));
                    continue;
                }
            }
        };
        cards.push(card);
    }
    (Value::Array(cards), mtime)
}

/// カードを書き、並びに残らなかったカードのファイルを消す。
pub fn write(dir: &Path, cover: &Value) -> Result<(), String> {
    let Value::Array(cards) = cover else {
        return Err("概要がカードの並びではありません".into());
    };
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut ids = Vec::new();
    let mut keep = HashSet::new();
    for card in cards {
        let Value::Object(card) = card else {
            return Err("カードが JSON オブジェクトではありません".into());
        };
        let id = card
            .get("id")
            .and_then(Value::as_str)
            .ok_or("カードに ID がありません")?;
        check_name(id)?;
        if ids.iter().any(|x| x == id) {
            return Err(format!("カードの ID「{id}」が重複しています"));
        }
        let ty = card
            .get("type")
            .and_then(Value::as_str)
            .ok_or("カードに種類が書かれていません")?;
        let mut body = card.clone();
        body.remove("id");
        if ty == DESC {
            let name = format!("{id}.md");
            let text = card.get("text").and_then(Value::as_str).unwrap_or_default();
            write_file(&dir.join(&name), text)?;
            keep.insert(name);
        } else if body.len() > 1 {
            let name = format!("{id}.json");
            write_json(&dir.join(&name), &body)?;
            keep.insert(name);
        }
        ids.push(id.to_owned());
    }
    let text = serde_json::to_string_pretty(&ids).map_err(|e| e.to_string())? + "\n";
    write_file(&dir.join(LAYOUT), &text)?;
    let rd = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let card = name.ends_with(".md") || name.ends_with(".json");
        if card && name != LAYOUT && !name.starts_with('.') && !keep.contains(&name) {
            let path = e.path();
            fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        }
    }
    Ok(())
}
