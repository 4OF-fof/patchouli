use std::collections::BTreeSet;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::SystemTime;

use serde::Serialize;

use crate::library::{
    DirItem, Library, Place, StoredGroup, StoredItem, check_name, dunce, listed, meta_path,
    numbered,
};

const TMP_END: &str = ".importing";

/// いまこのアプリが書いている仮のファイル。片付けで、取り込んでいる最中のものを残りとみなさないため。
static WRITING: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

fn writing() -> MutexGuard<'static, BTreeSet<PathBuf>> {
    WRITING.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 仮の名前。落ちたあとに片付けられるよう、移すか写すかと元の名前を入れる。
fn tmp_name(src: &Path, mv: bool) -> String {
    let name = src.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let how = if mv { 'm' } else { 'c' };
    format!(
        ".{}.{how}.{}{TMP_END}",
        uuid::Uuid::new_v4().simple(),
        fit(name)
    )
}

/// 仮の名前が長くなりすぎないよう、拡張子を残して縮める。
fn fit(name: &str) -> String {
    const MAX: usize = 200;
    if name.len() <= MAX {
        return name.to_owned();
    }
    let p = Path::new(name);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let mut out = String::new();
    for c in p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .chars()
    {
        if out.len() + c.len_utf8() + ext.len() > MAX {
            break;
        }
        out.push(c);
    }
    out + &ext
}

/// 仮の名前から、移していたかと元の名前を読む。
fn parse_tmp(name: &str) -> Option<(bool, &str)> {
    let rest = name.strip_prefix('.')?.strip_suffix(TMP_END)?;
    let (id, rest) = rest.split_once('.')?;
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    match rest.split_once('.')? {
        ("m", name) => Some((true, name)),
        ("c", name) => Some((false, name)),
        _ => None,
    }
}

/// 前に落ちたときに残った仮のファイルを片付ける。移していたものは元の名前で置き直して項目として読ませ、
/// 写していたものは元が残っているので消す。片付けたものがあれば true。
pub(crate) fn recover(dir: &Path, entries: &[DirItem], problems: &mut Vec<String>) -> bool {
    let mut any = false;
    for e in entries {
        let n = e.entry.file_name();
        let Some((mv, name)) = n.to_str().and_then(parse_tmp) else {
            continue;
        };
        let path = e.entry.path();
        if !e.meta.as_ref().is_some_and(fs::Metadata::is_file) || writing().contains(&path) {
            continue;
        }
        let done = if mv {
            fs::rename(&path, free_file(dir, name))
        } else {
            fs::remove_file(&path)
        };
        match done {
            Ok(()) => any = true,
            Err(err) => problems.push(format!("{}: {err}", path.display())),
        }
    }
    any
}

/// dir の中の、file_name か、番号を付けた空いている名前。
fn free_file(dir: &Path, file_name: &str) -> PathBuf {
    let src = Path::new(file_name);
    let stem = src.file_stem().and_then(|n| n.to_str()).unwrap_or_default();
    let stem = if stem.is_empty() {
        "取り込み途中"
    } else {
        stem
    };
    let ext = src.extension().and_then(|e| e.to_str());
    let file = |n: &str| match ext {
        Some(ext) => dir.join(format!("{n}.{ext}")),
        None => dir.join(n),
    };
    // 前のファイルの .meta だけが残っていると、それを引き継いでしまうので避ける
    file(&numbered(stem, |n| {
        file(n).exists() || meta_path(&file(n)).exists()
    }))
}

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

/// フォルダの中のものと、フォルダかどうか。リンク先がフォルダのシンボリックリンクは、輪になることがあるので入れない。
fn entries(dir: &Path) -> Vec<(PathBuf, bool)> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(PathBuf, bool)> = rd
        .filter_map(Result::ok)
        .filter_map(|e| {
            let t = e.file_type().ok()?;
            let p = e.path();
            (listed(&p) && !(t.is_symlink() && p.is_dir())).then_some((p, t.is_dir()))
        })
        .collect();
    out.sort();
    out
}

fn files_in(dir: &Path, out: &mut Vec<PathBuf>) -> usize {
    let mut dirs = 0;
    for (p, is_dir) in entries(dir) {
        if is_dir {
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

fn touch(p: &Path) -> std::io::Result<()> {
    File::options()
        .write(true)
        .open(p)?
        .set_modified(SystemTime::now())
}

/// 取り込むものを、ライブラリを触らずに読んだもの。
pub struct Gathered {
    root: PathBuf,
    files: Vec<PathBuf>,
    folders: Vec<Folder>,
    out: Imported,
}

struct Folder {
    path: PathBuf,
    files: Vec<PathBuf>,
    folders: Vec<Folder>,
}

/// 置き場所とグループを決めたもの。
pub struct Planned {
    root: PathBuf,
    jobs: Vec<Job>,
    dirs: Vec<PathBuf>,
    emptied: Vec<PathBuf>,
    out: Imported,
}

struct Job {
    src: PathBuf,
    dir: PathBuf,
    place: Place,
}

/// 置き場所の中へ、仮の名前で入れたもの。
pub struct Staged {
    src: PathBuf,
    tmp: PathBuf,
    dir: PathBuf,
    place: Place,
}

impl Drop for Staged {
    fn drop(&mut self) {
        writing().remove(&self.tmp);
    }
}

/// 取り込みは gather・plan_import・stage・finish_import の順に行う。
/// ファイルを読む・動かす gather と stage はライブラリのロックの外で呼べる。
pub fn gather(paths: &[PathBuf], root: &Path) -> Gathered {
    let mut g = Gathered {
        root: root.to_owned(),
        files: Vec::new(),
        folders: Vec::new(),
        out: Imported::default(),
    };
    for p in paths {
        let p = match fs::canonicalize(p) {
            Ok(p) => dunce(p),
            Err(e) => {
                g.out.failed.push(format!("{}: {e}", p.display()));
                continue;
            }
        };
        if p.starts_with(root) {
            g.out.skipped += 1;
        } else if p.is_dir() {
            g.folders.push(folder(p));
        } else if listed(&p) {
            g.files.push(p);
        } else {
            g.out.skipped += 1;
        }
    }
    g
}

fn folder(path: PathBuf) -> Folder {
    let mut f = Folder {
        files: Vec::new(),
        folders: Vec::new(),
        path,
    };
    for (p, is_dir) in entries(&f.path) {
        if is_dir {
            f.folders.push(folder(p));
        } else {
            f.files.push(p);
        }
    }
    f
}

/// 別のドライブへは rename できないので、コピーしてから消す
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to).or_else(|_| fs::copy(from, to).and_then(|_| fs::remove_file(from)))
}

/// mv なら元の場所から移す。うまくいかなかったものは out.failed に入れる。
pub fn stage(p: &mut Planned, mv: bool) -> Vec<Staged> {
    let mut staged = Vec::new();
    for job in std::mem::take(&mut p.jobs) {
        let tmp = job.dir.join(tmp_name(&job.src, mv));
        writing().insert(tmp.clone());
        let put = if mv {
            move_file(&job.src, &tmp)
        } else {
            fs::copy(&job.src, &tmp).map(|_| ())
        };
        match put.and_then(|()| touch(&tmp)) {
            Ok(()) => staged.push(Staged {
                src: job.src,
                tmp,
                dir: job.dir,
                place: job.place,
            }),
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                writing().remove(&tmp);
                p.out.failed.push(format!("{}: {e}", job.src.display()));
            }
        }
    }
    staged
}

/// 取り込みきれなかったものを元に戻す。
pub fn unstage(staged: Vec<Staged>, mv: bool) {
    for s in staged {
        let _ = if mv {
            move_file(&s.tmp, &s.src)
        } else {
            fs::remove_file(&s.tmp)
        };
    }
}

impl Library {
    /// フォルダは、中のフォルダも含めてグループとして取り込む。
    pub fn plan_import(&mut self, g: Gathered, place: &Place) -> Result<Planned, String> {
        if g.root != self.root() {
            return Err("取り込むあいだに、ライブラリが切り替わりました".into());
        }
        let (dest, project, group) = self.place_dir(place)?;
        let at = Place { project, group };
        let mut p = Planned {
            root: g.root,
            jobs: Vec::new(),
            dirs: vec![dest.clone()],
            emptied: Vec::new(),
            out: g.out,
        };
        for src in g.files {
            p.jobs.push(Job {
                src,
                dir: dest.clone(),
                place: at.clone(),
            });
        }
        for f in g.folders {
            self.plan_folder(f, &at, &mut p);
        }
        Ok(p)
    }

    fn plan_folder(&mut self, f: Folder, place: &Place, p: &mut Planned) {
        let base = f
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("取り込んだフォルダ");
        let g = match self.create_group(base, place) {
            Ok(g) => g,
            Err(e) => {
                p.out.failed.push(format!("{}: {e}", f.path.display()));
                return;
            }
        };
        let inner = Place {
            project: g.project.clone(),
            group: Some(g.id.clone()),
        };
        p.dirs.push(g.dir.clone());
        for src in f.files {
            p.jobs.push(Job {
                src,
                dir: g.dir.clone(),
                place: inner.clone(),
            });
        }
        p.out.groups.push(g);
        for sub in f.folders {
            self.plan_folder(sub, &inner, p);
        }
        p.emptied.push(f.path);
    }

    /// 取り込めなかったときは staged を残すので、呼び出し元が unstage で戻す。
    pub fn finish_import(
        &mut self,
        p: Planned,
        staged: &mut Vec<Staged>,
        mv: bool,
    ) -> Result<Imported, String> {
        if p.root != self.root() {
            return Err("取り込むあいだに、ライブラリが切り替わりました".into());
        }
        let mut out = p.out;
        for s in std::mem::take(staged) {
            let name = s
                .src
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            match self.put_in(name, &s.dir, &s.place, |to| fs::rename(&s.tmp, to)) {
                Ok((item, problems)) => {
                    out.items.extend(item);
                    out.failed.extend(problems);
                }
                Err(e) => {
                    out.failed.push(format!("{}: {e}", s.src.display()));
                    unstage(vec![s], mv);
                }
            }
        }
        // 取り込まなかったファイルが残っていれば、フォルダは消えない
        if mv {
            for d in &p.emptied {
                let _ = fs::remove_dir(d);
            }
        }
        self.reprint(p.dirs);
        Ok(out)
    }

    /// file_name の名前で dir に書き、項目として読む。同じ名前があれば番号を付ける。
    fn put_in(
        &mut self,
        file_name: &str,
        dir: &Path,
        place: &Place,
        write: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(Option<StoredItem>, Vec<String>), String> {
        let to = free_file(dir, file_name);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_does_not_follow_a_link_to_a_parent_folder() {
        let root = std::env::temp_dir().join(format!(
            "patchouli-import-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let a = root.join("a");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("x.png"), b"").unwrap();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir("..", a.join("link"));
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink("..", a.join("link"));
        if let Err(e) = linked {
            let _ = fs::remove_dir_all(&root);
            eprintln!("シンボリックリンクを作れないので確かめない: {e}");
            return;
        }
        let info = inspect(std::slice::from_ref(&a), None);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(info.files, 1);
        assert_eq!(info.folders[0].subfolders, 0);
    }
}
