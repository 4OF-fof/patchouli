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

pub const LINK_SCHEME: &str = "patchouli:";

/// `[表示名](patchouli:ID)` の表示名を、name_of が返すいまの名前に書き換える。変わらなければ None。
pub fn rename_links<'a>(body: &str, name_of: impl Fn(&str) -> Option<&'a str>) -> Option<String> {
    let mut out = String::with_capacity(body.len());
    let mut changed = false;
    let mut fence: Option<&str> = None;
    for line in body.split_inclusive('\n') {
        let t = line.trim();
        if let Some(f) = fence {
            if fence_of(t).is_some_and(|c| c.starts_with(f) && c.len() == t.len()) {
                fence = None;
            }
            out.push_str(line);
            continue;
        }
        if let Some(f) = fence_of(t) {
            fence = Some(f);
            out.push_str(line);
            continue;
        }
        changed |= rename_in_line(line, &name_of, &mut out);
    }
    changed.then_some(out)
}

fn fence_of(line: &str) -> Option<&str> {
    let c = *line.as_bytes().first()?;
    if c != b'`' && c != b'~' {
        return None;
    }
    let n = run(line.as_bytes(), 0, c);
    (n >= 3).then(|| &line[..n])
}

fn run(b: &[u8], from: usize, c: u8) -> usize {
    b[from..].iter().take_while(|&&x| x == c).count()
}

fn code_end(b: &[u8], mut j: usize, n: usize) -> Option<usize> {
    while j < b.len() {
        if b[j] == b'`' {
            let m = run(b, j, b'`');
            if m == n {
                return Some(j + m);
            }
            j += m;
        } else {
            j += 1;
        }
    }
    None
}

/// i の `[` から始まる patchouli: のリンクの、終わりの位置と表示名と ID。
fn link_at(line: &str, i: usize) -> Option<(usize, &str, &str)> {
    let b = line.as_bytes();
    let mut j = i + 1;
    while j < b.len() {
        match b[j] {
            b'\\' => j += 2,
            b'[' => return None,
            b']' => break,
            _ => j += 1,
        }
    }
    if j >= b.len() {
        return None;
    }
    let rest = line[j + 1..].strip_prefix('(')?.strip_prefix(LINK_SCHEME)?;
    let len = rest.find(|c: char| c == ')' || c.is_whitespace())?;
    if len == 0 || !rest[len..].starts_with(')') {
        return None;
    }
    let end = j + 2 + LINK_SCHEME.len() + len + 1;
    Some((end, &line[i + 1..j], &rest[..len]))
}

fn rename_in_line<'a>(
    line: &str,
    name_of: &impl Fn(&str) -> Option<&'a str>,
    out: &mut String,
) -> bool {
    let b = line.as_bytes();
    let (mut i, mut copied, mut changed) = (0, 0, false);
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'`' => {
                let n = run(b, i, b'`');
                i = code_end(b, i + n, n).unwrap_or(i + n);
            }
            b'[' => match link_at(line, i) {
                Some((end, text, id)) => {
                    if let Some(name) = name_of(id)
                        && unescape(text) != name
                    {
                        out.push_str(&line[copied..i]);
                        out.push_str(&format!("[{}]({LINK_SCHEME}{id})", escape(name)));
                        copied = end;
                        changed = true;
                    }
                    i = end;
                }
                None => i += 1,
            },
            _ => i += 1,
        }
    }
    out.push_str(&line[copied..]);
    changed
}

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut it = text.chars().peekable();
    while let Some(c) = it.next() {
        match it.peek() {
            Some(&n) if c == '\\' && n.is_ascii_punctuation() => {
                out.push(n);
                it.next();
            }
            _ => out.push(c),
        }
    }
    out
}

/// 名前を表示名に書けるようにする。`_` と `~` は語の中なら書式にならないので、そのまま残す。
fn escape(name: &str) -> String {
    let chars: Vec<char> = name.chars().collect();
    let mut out = String::with_capacity(name.len());
    for (k, &c) in chars.iter().enumerate() {
        let inner = |d: Option<&char>| d.is_some_and(|d| d.is_alphanumeric());
        let edge = !(inner(k.checked_sub(1).and_then(|p| chars.get(p))) && inner(chars.get(k + 1)));
        if r"\[]*`<|".contains(c) || ("_~".contains(c) && edge) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
