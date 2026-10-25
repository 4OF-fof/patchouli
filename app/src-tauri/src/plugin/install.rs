//! 外のプラグインを取得先から取り込み、アプリのデータフォルダ（`<dir>/<id>/`）に入れる。
//! どこから入れたかは `<dir>/sources.json` に残し、ほかのライブラリで使うときにも記録できるようにする。

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::record::Source;
use super::{MANIFEST, Manifest};
use crate::library::{read_json, write_json};

const SOURCES: &str = "sources.json";

fn sources(dir: &Path) -> Map<String, Value> {
    read_json(&dir.join(SOURCES))
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// id に使えるのは、英小文字・数字と「. _ -」だけ。
fn check_id(id: &str) -> Result<(), String> {
    let ok = id
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b".-_".contains(&b))
        && id.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric());
    if ok {
        Ok(())
    } else {
        Err(format!("「{id}」はプラグインの id に使えない"))
    }
}

/// 取得先から取り込んで、dir に入れる。builtin は組み込みのプラグインの id（同じ id では入れられない）。
pub fn install(source: &Source, dir: &Path, builtin: &[String]) -> Result<Manifest, String> {
    let work = dir.join(format!(".install-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&work).map_err(|e| format!("{}: {e}", work.display()))?;
    let r = fetch(source, &work).and_then(|root| place(&root, source, dir, builtin));
    let _ = fs::remove_dir_all(&work);
    r
}

/// 取得先の zip を work に広げ、plugin.json のあるフォルダを返す。
fn fetch(source: &Source, work: &Path) -> Result<PathBuf, String> {
    let out = work.join("x");
    let Source::Local(p) = source;
    if p.is_dir() {
        return Err(format!(
            "{}: プラグインは zip からだけ入れられる",
            p.display()
        ));
    }
    let bytes = fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
    unzip(&bytes, &out)?;
    if out.join(MANIFEST).is_file() {
        return Ok(out);
    }
    // zip の中が 1 つのフォルダに入っているとき
    let mut dirs = fs::read_dir(&out)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir());
    match (dirs.next(), dirs.next()) {
        (Some(d), None) if d.path().join(MANIFEST).is_file() => Ok(d.path()),
        _ => Err(format!("{MANIFEST} が見つからない")),
    }
}

fn unzip(bytes: &[u8], out: &Path) -> Result<(), String> {
    let mut z = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    z.extract(out).map_err(|e| e.to_string())
}

/// 広げたものを確かめて dir/<id> に置き、取得先を残す。
fn place(root: &Path, source: &Source, dir: &Path, builtin: &[String]) -> Result<Manifest, String> {
    let m = Manifest::read(root)?;
    check_id(&m.id)?;
    if builtin.contains(&m.id) {
        return Err(format!("{} は組み込みのプラグインと同じ id", m.id));
    }
    let dest = dir.join(&m.id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    fs::rename(root, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    let mut s = sources(dir);
    s.insert(
        m.id.clone(),
        serde_json::to_value(source).map_err(|e| e.to_string())?,
    );
    write_json(&dir.join(SOURCES), &s)?;
    Ok(m)
}
