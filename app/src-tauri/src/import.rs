//! ファイルの取り込み。元のファイルは残し、ライブラリへコピーする。
//!
//! - 名前が重なるときは「名前 2」「名前 3」…と番号を付ける
//! - フォルダは、ひとつずつ、中のファイルを平らに入れるか、新しいプロジェクトにするかを選ぶ
//! - 取り込めない形式のファイルと、ライブラリの中にあるファイルは取り込まない

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::library::{Library, StoredItem, StoredProject, check_name, dunce, meta_path};
use crate::plugin::Registry;

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
    /// 取り込まなかったファイルの数（取り込めない形式、ライブラリの中にあるもの）。
    pub skipped: usize,
    /// コピーできなかったもの（「パス: 理由」）。
    pub failed: Vec<String>,
}

/// フォルダの中のファイル（下の階層も）を名前順に。`.` で始まるものと `.meta` は除く。
/// 返すのは、下の階層にあったフォルダの数。
fn files_in(dir: &Path, out: &mut Vec<PathBuf>) -> usize {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    let mut paths: Vec<PathBuf> = rd
        .filter_map(Result::ok)
        .filter(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            !n.starts_with('.') && !n.ends_with(".meta")
        })
        .map(|e| e.path())
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
pub fn inspect(paths: &[PathBuf], root: Option<&Path>, plugins: &Registry) -> DropInfo {
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
                files: fs.iter().filter(|f| plugins.knows_path(f)).count(),
                subfolders,
            });
        } else if plugins.knows_path(p) {
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
        let plugins = self.plugins();
        let root = self.root().to_owned();
        let dest = match folder {
            Some(f) => {
                check_name(f)?;
                let d = root.join(f);
                if !d.is_dir() {
                    return Err(format!("プロジェクト「{f}」がない"));
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
                if plugins.knows_path(&p) {
                    self.copy_in(&p, &dest, folder, &mut out);
                } else {
                    out.skipped += 1;
                }
                continue;
            }
            let mut files = Vec::new();
            files_in(&p, &mut files);
            let (ok, ng): (Vec<_>, Vec<_>) = files.into_iter().partition(|f| plugins.knows_path(f));
            out.skipped += ng.len();
            if !projects.contains(&key) {
                for f in &ok {
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
            for f in &ok {
                self.copy_in(f, &dir, Some(&name), &mut out);
            }
        }
        Ok(out)
    }

    fn copy_in(&mut self, src: &Path, dir: &Path, folder: Option<&str>, out: &mut Imported) {
        let stem = src.file_stem().and_then(|n| n.to_str()).unwrap_or_default();
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or_default();
        let file = |n: &str| dir.join(format!("{n}.{ext}"));
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
