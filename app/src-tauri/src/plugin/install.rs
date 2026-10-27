use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::record::Source;
use super::{MANIFEST, Manifest};

/// id に使えるのは、英小文字・数字と「. _ -」だけ。
fn check_id(id: &str) -> Result<(), String> {
    let ok = id
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b".-_".contains(&b))
        && id.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric());
    if ok {
        Ok(())
    } else {
        Err(format!("プラグイン ID「{id}」の形式が正しくありません"))
    }
}

pub fn install(
    source: &Source,
    dir: &Path,
    builtin: &[String],
    expect: Option<&str>,
) -> Result<(Manifest, String), String> {
    let work = dir.join(format!(".install-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&work).map_err(|e| format!("{}: {e}", work.display()))?;
    let r = fetch(source, &work, expect)
        .and_then(|(root, hash)| Ok((place(&root, dir, builtin)?, hash)));
    let _ = fs::remove_dir_all(&work);
    r
}

fn fetch(source: &Source, work: &Path, expect: Option<&str>) -> Result<(PathBuf, String), String> {
    let out = work.join("x");
    let Source::Local(p) = source;
    if p.is_dir() {
        return Err(format!("{}: ZIP ファイルを選択してください", p.display()));
    }
    let bytes = fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
    let hex: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let hash = format!("sha256:{hex}");
    if expect.is_some_and(|e| e != hash) {
        return Err(format!(
            "{}: ライブラリに記録されたものと内容が異なります",
            p.display()
        ));
    }
    unzip(&bytes, &out)?;
    if out.join(MANIFEST).is_file() {
        Ok((out, hash))
    } else {
        Err(format!("アーカイブの最上位に {MANIFEST} が見つかりません"))
    }
}

pub fn unpack(zip: &Path, out: &Path) -> Result<(), String> {
    let bytes = fs::read(zip).map_err(|e| format!("{}: {e}", zip.display()))?;
    unzip(&bytes, out).map_err(|e| format!("{}: {e}", zip.display()))?;
    if out.join(MANIFEST).is_file() {
        Ok(())
    } else {
        Err(format!(
            "{}: アーカイブの最上位に {MANIFEST} が見つかりません",
            zip.display()
        ))
    }
}

fn unzip(bytes: &[u8], out: &Path) -> Result<(), String> {
    let mut z = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    z.extract(out).map_err(|e| e.to_string())
}

fn place(root: &Path, dir: &Path, builtin: &[String]) -> Result<Manifest, String> {
    let m = Manifest::read(root)?;
    check_id(&m.id)?;
    if builtin.contains(&m.id) {
        return Err(format!(
            "「{}」は組み込みプラグインと ID が重複しています",
            m.id
        ));
    }
    let dest = dir.join(&m.id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    fs::rename(root, &dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    Ok(m)
}
