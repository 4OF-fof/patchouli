use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::library::{Library, StoredItem, StoredProject, check_name, dunce, listed, meta_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropInfo {
    pub files: usize,
    pub folders: Vec<FolderInfo>,
    pub loose: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub key: usize,
    pub name: String,
    pub files: usize,
    pub subfolders: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub items: Vec<StoredItem>,
    pub projects: Vec<StoredProject>,
    pub skipped: usize,
    pub failed: Vec<String>,
}

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

fn touch(p: &Path) -> std::io::Result<()> {
    File::options()
        .write(true)
        .open(p)?
        .set_modified(SystemTime::now())
}

impl Library {
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
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        let put = |to: &Path| fs::copy(src, to).and_then(|_| touch(to)).map(drop);
        match self.put_in(name, dir, folder, put) {
            Ok((item, problems)) => {
                out.items.extend(item);
                out.failed.extend(problems);
            }
            Err(e) => out.failed.push(format!("{}: {e}", src.display())),
        }
    }

    /// file_name の名前で dir に書き、項目として読む。同じ名前があれば番号を付ける。
    fn put_in(
        &mut self,
        file_name: &str,
        dir: &Path,
        folder: Option<&str>,
        write: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(Option<StoredItem>, Vec<String>), String> {
        let src = Path::new(file_name);
        let stem = src.file_stem().and_then(|n| n.to_str()).unwrap_or_default();
        let ext = src.extension().and_then(|e| e.to_str());
        let file = |n: &str| match ext {
            Some(ext) => dir.join(format!("{n}.{ext}")),
            None => dir.join(n),
        };
        // 前のファイルの .meta だけが残っていると、それを引き継いでしまうので避ける
        let name = numbered(stem, |n| file(n).exists() || meta_path(&file(n)).exists());
        let to = file(&name);
        write(&to).map_err(|e| e.to_string())?;
        let mut problems = Vec::new();
        let row = self.read_item(&to, folder, None, &mut problems);
        if let Some(row) = &row {
            self.remember(row);
        }
        Ok((row.map(|r| r.item), problems))
    }

    /// 貼り付けたものなど、ファイルのないデータを取り込む。
    pub fn import_data(
        &mut self,
        file_name: &str,
        bytes: &[u8],
        folder: Option<&str>,
    ) -> Result<StoredItem, String> {
        let file_name = Path::new(file_name)
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|n| check_name(n).is_ok() && listed(Path::new(n)))
            .ok_or_else(|| format!("「{file_name}」はファイル名として使用できません"))?;
        let dir = match folder {
            Some(f) => {
                check_name(f)?;
                self.root().join(f)
            }
            None => self.root().to_owned(),
        };
        if !dir.is_dir() {
            return Err(format!("プロジェクト「{}」が見つかりません", folder.unwrap_or_default()));
        }
        let (item, problems) = self.put_in(file_name, &dir, folder, |to| fs::write(to, bytes))?;
        item.ok_or_else(|| {
            problems
                .into_iter()
                .next()
                .unwrap_or_else(|| format!("「{file_name}」の読み込みに失敗しました"))
        })
    }
}
