use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::library::{
    Library, Place, StoredGroup, StoredItem, check_name, dunce, listed, meta_path,
};

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
    pub groups: Vec<StoredGroup>,
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
    /// フォルダは、中のフォルダも含めてグループとして取り込む。mv なら、元の場所から移す。
    pub fn import(
        &mut self,
        paths: &[PathBuf],
        place: &Place,
        mv: bool,
    ) -> Result<Imported, String> {
        let root = self.root().to_owned();
        let (dest, project, group) = self.place_dir(place)?;
        let at = Place { project, group };
        let mut out = Imported::default();
        for p in paths {
            let p = match fs::canonicalize(p) {
                Ok(p) => dunce(p),
                Err(e) => {
                    out.failed.push(format!("{}: {e}", p.display()));
                    continue;
                }
            };
            if p.starts_with(&root) {
                out.skipped += 1;
            } else if p.is_dir() {
                self.copy_dir(&p, &at, mv, &mut out);
            } else if listed(&p) {
                self.copy_in(&p, &dest, &at, mv, &mut out);
            } else {
                out.skipped += 1;
            }
        }
        self.reprint([dest]);
        Ok(out)
    }

    fn copy_dir(&mut self, src: &Path, place: &Place, mv: bool, out: &mut Imported) {
        let base = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("取り込んだフォルダ");
        let g = match self.create_group(base, place) {
            Ok(g) => g,
            Err(e) => {
                out.failed.push(format!("{}: {e}", src.display()));
                return;
            }
        };
        let inner = Place {
            project: g.project.clone(),
            group: Some(g.id.clone()),
        };
        let dir = g.dir.clone();
        out.groups.push(g);
        let Ok(rd) = fs::read_dir(src) else { return };
        let mut paths: Vec<PathBuf> = rd
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| listed(p))
            .collect();
        paths.sort();
        for p in paths {
            if p.is_dir() {
                self.copy_dir(&p, &inner, mv, out);
            } else {
                self.copy_in(&p, &dir, &inner, mv, out);
            }
        }
        // 取り込まなかったファイルが残っていれば、フォルダは消えない
        if mv {
            let _ = fs::remove_dir(src);
        }
        self.reprint([dir]);
    }

    fn copy_in(&mut self, src: &Path, dir: &Path, place: &Place, mv: bool, out: &mut Imported) {
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        // 別のドライブへは rename できないので、コピーしてから消す
        let put = |to: &Path| {
            if mv {
                fs::rename(src, to)
                    .or_else(|_| fs::copy(src, to).and_then(|_| fs::remove_file(src)))?;
            } else {
                fs::copy(src, to)?;
            }
            touch(to)
        };
        match self.put_in(name, dir, place, put) {
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
        place: &Place,
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
        let row = self.read_item(
            &to,
            place.project.as_deref(),
            place.group.as_deref(),
            None,
            None,
            &mut problems,
        );
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
        place: &Place,
    ) -> Result<StoredItem, String> {
        let file_name = Path::new(file_name)
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|n| check_name(n).is_ok() && listed(Path::new(n)))
            .ok_or_else(|| format!("「{file_name}」はファイル名として使用できません"))?;
        let (dir, project, group) = self.place_dir(place)?;
        let at = Place { project, group };
        let (item, problems) = self.put_in(file_name, &dir, &at, |to| fs::write(to, bytes))?;
        self.reprint([dir]);
        item.ok_or_else(|| {
            problems
                .into_iter()
                .next()
                .unwrap_or_else(|| format!("「{file_name}」の読み込みに失敗しました"))
        })
    }
}
