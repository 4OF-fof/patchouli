//! ファイルの取り込み。元のファイルは残し、ライブラリへコピーする。
//!
//! - 名前が重なるときは「名前 2」「名前 3」…と番号を付ける
//! - フォルダは、ひとつずつ、中のファイルを平らに入れるか、新しいプロジェクトにするかを選ぶ
//! - 対応するプラグインのない形式のファイルも取り込む。ライブラリで読まないもの（`.` で始まるもの、隠しファイル、`.meta`）と、
//!   ライブラリの中にあるファイルは取り込まない

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::library::{Library, StoredItem, StoredProject, check_name, dunce, listed, meta_path};

/// 落とそうとしているものの中身。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropInfo {
    /// 取り込めるファイルの数（フォルダの中も数える）。
    pub files: usize,
    pub folders: Vec<FolderInfo>,
    /// フォルダに入っていない、取り込めるファイルの数。
    pub loose: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    /// 落としたものの中での位置。取り込むときに、どのフォルダをプロジェクトにするかをこれで指す。
    pub key: usize,
    pub name: String,
    /// 中の取り込めるファイルの数（下の階層も数える）。
    pub files: usize,
    /// 下の階層にあるフォルダの数。
    pub subfolders: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub items: Vec<StoredItem>,
    pub projects: Vec<StoredProject>,
    /// 取り込まなかったファイルの数（ライブラリで読まないもの、ライブラリの中にあるもの）。
    pub skipped: usize,
    /// コピーできなかったもの（「パス: 理由」）。
    pub failed: Vec<String>,
}

/// フォルダの中のファイル（下の階層も）のうち、ライブラリで読むもの（listed）を名前順に。
/// 返すのは、下の階層にあったフォルダの数。
fn files_in(dir: &Path, out: &mut Vec<PathBuf>) -> usize {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    let mut paths: Vec<PathBuf> = rd
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| listed(p))
        .collect();
    paths.sort();
    let mut dirs = 0;
    for p in paths {
        if p.is_dir() {
            dirs += 1 + files_in(&p, out);
        } else {
            out.push(p);
        }
    }
    dirs
}

/// 取り込めるものを数える。root（開いているライブラリ）の中にあるものは数えない。
pub fn inspect(paths: &[PathBuf], root: Option<&Path>) -> DropInfo {
    let mut folders = Vec::new();
    let mut loose = 0;
    for (key, p) in paths.iter().enumerate() {
        let inside = fs::canonicalize(p)
            .map(dunce)
            .is_ok_and(|p| root.is_some_and(|r| p.starts_with(r)));
        if inside {
            continue;
        }
        if p.is_dir() {
            let mut fs = Vec::new();
            let subfolders = files_in(p, &mut fs);
            folders.push(FolderInfo {
                key,
                name: p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                files: fs.len(),
                subfolders,
            });
        } else if listed(p) {
            loose += 1;
        }
    }
    DropInfo {
        files: loose + folders.iter().map(|f| f.files).sum::<usize>(),
        folders,
        loose,
    }
}

/// 「名前」「名前 2」「名前 3」…のうち、taken でない最初のもの。
fn numbered(base: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut name = base.to_owned();
    for n in 2.. {
        if !taken(&name) {
            break;
        }
        name = format!("{base} {n}");
    }
    name
}

/// 取り込んだものは、いま動いたものとして扱う。
fn touch(p: &Path) -> std::io::Result<()> {
    File::options()
        .write(true)
        .open(p)?
        .set_modified(SystemTime::now())
}

impl Library {
    /// paths を取り込む。ファイルとフォルダの中身は folder（None はどこにも入れない）へ入れる。
    /// projects に位置があるフォルダは、新しいプロジェクトを作ってそこへ入れる。
    pub fn import(
        &mut self,
        paths: &[PathBuf],
        folder: Option<&str>,
        projects: &[usize],
    ) -> Result<Imported, String> {
        let root = self.root().to_owned();
        let dest = match folder {
            Some(f) => {
                check_name(f)?;
                let d = root.join(f);
                if !d.is_dir() {
                    return Err(format!("プロジェクト「{f}」が見つかりません"));
                }
                d
            }
            None => root.clone(),
        };
        let mut out = Imported::default();
        for (key, p) in paths.iter().enumerate() {
            let p = match fs::canonicalize(p) {
                Ok(p) => dunce(p),
                Err(e) => {
                    out.failed.push(format!("{}: {e}", p.display()));
                    continue;
                }
            };
            if p.starts_with(&root) {
                out.skipped += 1;
                continue;
            }
            if !p.is_dir() {
                if listed(&p) {
                    self.copy_in(&p, &dest, folder, &mut out);
                } else {
                    out.skipped += 1;
                }
                continue;
            }
            let mut files = Vec::new();
            files_in(&p, &mut files);
            if !projects.contains(&key) {
                for f in &files {
                    self.copy_in(f, &dest, folder, &mut out);
                }
                continue;
            }
            let base = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("取り込んだフォルダ");
            let name = numbered(base, |n| {
                root.join(n).exists() || meta_path(&root.join(n)).exists()
            });
            let project = match self.create_project(&name) {
                Ok(pr) => pr,
                Err(e) => {
                    out.failed.push(format!("{}: {e}", p.display()));
                    continue;
                }
            };
            out.projects.push(project);
            let dir = root.join(&name);
            for f in &files {
                self.copy_in(f, &dir, Some(&name), &mut out);
            }
        }
        Ok(out)
    }

    fn copy_in(&mut self, src: &Path, dir: &Path, folder: Option<&str>, out: &mut Imported) {
        let stem = src.file_stem().and_then(|n| n.to_str()).unwrap_or_default();
        let ext = src.extension().and_then(|e| e.to_str());
        let file = |n: &str| match ext {
            Some(ext) => dir.join(format!("{n}.{ext}")),
            None => dir.join(n),
        };
        // 前のファイルの .meta だけが残っていると、それを引き継いでしまうので避ける
        let name = numbered(stem, |n| file(n).exists() || meta_path(&file(n)).exists());
        let to = file(&name);
        if let Err(e) = fs::copy(src, &to).and_then(|_| touch(&to)) {
            out.failed.push(format!("{}: {e}", src.display()));
            return;
        }
        let mut problems = Vec::new();
        if let Some(row) = self.read_item(&to, folder, None, &mut problems) {
            self.remember(&row);
            out.items.push(row.item);
        }
        out.failed.extend(problems);
    }
}
