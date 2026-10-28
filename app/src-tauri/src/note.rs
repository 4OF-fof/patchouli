use serde_yaml_ng::Value;

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
