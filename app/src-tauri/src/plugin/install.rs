use std::collections::BTreeSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::record::Source;
use super::{MANIFEST, Manifest, PluginStatus, commands, github};

/// id に使えるのは、英小文字・数字と「. _ -」だけ。
pub fn check_id(id: &str) -> Result<(), String> {
    if super::rules().id_ok(id) {
        Ok(())
    } else {
        Err(format!("プラグイン ID「{id}」の形式が正しくありません"))
    }
}

/// GitHub から入れるときに、どのリリースを取るか。
#[derive(Debug, Clone)]
pub enum Want {
    Latest { prerelease: bool },
    Tag(String),
}

/// 入れる前に見せる、プラグインができること。
#[derive(Debug, Clone, Default, Serialize)]
pub struct Risk {
    /// スクリプトを持ち、本体と同じ権限で動く。
    pub full: bool,
    pub permissions: Vec<String>,
    pub commands: Vec<String>,
    pub fetch: Vec<String>,
}

impl Risk {
    fn of(m: &Manifest) -> Risk {
        let commands: BTreeSet<String> = m
            .required
            .commands
            .keys()
            .chain(m.optional.commands.keys())
            .cloned()
            .collect();
        Risk {
            full: m.script.is_some() || m.wants_script(),
            permissions: super::permissions_of(m),
            commands: commands.into_iter().collect(),
            fetch: super::fetch_of(m),
        }
    }

    fn added(self, before: &Risk) -> Risk {
        let new = |now: Vec<String>, old: &[String]| -> Vec<String> {
            now.into_iter().filter(|x| !old.contains(x)).collect()
        };
        Risk {
            full: self.full && !before.full,
            permissions: new(self.permissions, &before.permissions),
            commands: new(self.commands, &before.commands),
            fetch: new(self.fetch, &before.fetch),
        }
    }
}

/// 取ってきて広げ、まだ置いていないもの。捨てると広げたものも消える。
pub struct Staged {
    pub manifest: Manifest,
    pub source: Source,
    pub tag: Option<String>,
    pub hash: String,
    /// 入っているものより増えたもの。初めて入れるときは全部。
    pub added: Risk,
    /// このライブラリに、まだ入っていない。
    pub first: bool,
    work: Work,
}

/// 広げる場所。捨てると中身ごと消す。
struct Work(PathBuf);

impl Drop for Work {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

impl Staged {
    pub fn preview(&self) -> PluginStatus {
        super::idle(&self.manifest, false, true, None, Vec::new())
    }
}

/// 取得先から取ってきて dir の中に広げ、入れてよいものかを確かめる。
/// update は更新するプラグインの ID。中のものの ID が違うときと、入っているものより版が古いときは入れない。
/// expect は記録したハッシュ。違うものは入れない。
pub fn stage(
    source: &Source,
    want: &Want,
    dir: &Path,
    builtin: &[String],
    expect: Option<&str>,
    update: Option<&str>,
) -> Result<Staged, String> {
    let work = Work(dir.join(format!(".install-{}", uuid::Uuid::new_v4().simple())));
    fs::create_dir_all(&work.0).map_err(|e| format!("{}: {e}", work.0.display()))?;
    let (bytes, tag) = fetch(source, want)?;
    let hash = hash_of(&bytes);
    if expect.is_some_and(|e| e != hash) {
        return Err(format!(
            "{}: ライブラリに記録されたものと内容が異なります",
            label(source, tag.as_deref())
        ));
    }
    let root = work.0.join("x");
    unzip(&bytes, &root)?;
    if !root.join(MANIFEST).is_file() {
        return Err(format!("アーカイブの最上位に {MANIFEST} が見つかりません"));
    }
    let m = Manifest::read(&root)?;
    check_id(&m.id)?;
    if builtin.contains(&m.id) {
        return Err(format!("「{}」はコア機能と ID が重複しています", m.id));
    }
    let old = Manifest::read(&dir.join(&m.id)).ok();
    if let Some(id) = update {
        if m.id != id {
            return Err(format!(
                "ID が一致しません（更新するもの：{id}、ファイルの中身：{}）",
                m.id
            ));
        }
        if let Some(old) = &old
            && commands::older(&m.version, &old.version)
        {
            return Err(format!(
                "インストール済みのバージョン（{}）より古いバージョン（{}）のため、更新しません",
                old.version, m.version
            ));
        }
    }
    let added = match &old {
        Some(old) => Risk::of(&m).added(&Risk::of(old)),
        None => Risk::of(&m),
    };
    Ok(Staged {
        manifest: m,
        source: source.clone(),
        tag,
        hash,
        added,
        first: old.is_none(),
        work,
    })
}

fn label(source: &Source, tag: Option<&str>) -> String {
    match (source, tag) {
        (Source::Local(p), _) => p.display().to_string(),
        (Source::Github(repo), Some(tag)) => format!("{repo} {tag}"),
        (Source::Github(repo), None) => repo.clone(),
    }
}

fn hash_of(bytes: &[u8]) -> String {
    let hex: String = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("sha256:{hex}")
}

fn fetch(source: &Source, want: &Want) -> Result<(Vec<u8>, Option<String>), String> {
    match source {
        Source::Local(p) => {
            if p.is_dir() {
                return Err(format!("{}: ZIP ファイルを選択してください", p.display()));
            }
            let bytes = fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
            Ok((bytes, None))
        }
        Source::Github(repo) => {
            let r = match want {
                Want::Latest { prerelease } => github::latest(repo, *prerelease)?,
                Want::Tag(tag) => github::tagged(repo, tag)?,
            };
            Ok((github::download(repo, &r)?, Some(r.tag)))
        }
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

/// 広げたものを dir/<id> に置く。
pub fn place(s: &Staged, dir: &Path) -> Result<(), String> {
    let root = s.work.0.join("x");
    let dest = dir.join(&s.manifest.id);
    // 新しいものを置けなかったときに戻せるよう、古いものは置き終えてから消す
    let old = dir.join(format!(".old-{}", uuid::Uuid::new_v4().simple()));
    let had = dest.exists();
    if had {
        fs::rename(&dest, &old).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    if let Err(e) = fs::rename(&root, &dest) {
        if had {
            let _ = fs::rename(&old, &dest);
        }
        return Err(format!("{}: {e}", dest.display()));
    }
    if had {
        let _ = fs::remove_dir_all(&old);
    }
    Ok(())
}
