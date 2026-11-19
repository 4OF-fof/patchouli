//! アーカイブの中のファイル。目次と取り出したものは、アーカイブの版ごとの置き場に残す。

pub(crate) mod ipc;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::plugin::{ArchiveOut, Runner};
use crate::{library, thumb};

const ENTRIES: &str = "entries.json";
const FILES: &str = "files";
const THUMBS: &str = "thumbs";
const WORK: &str = "work";

/// 置き場全体で残しておく大きさ。超えたら、使っていないアーカイブのものから消す。
const CAPACITY: u64 = 4 << 30;
const ENTRY_MAX: u64 = 16 << 30;
/// 取り出したあとにも残しておく空き容量。
const MARGIN: u64 = 1 << 30;
/// 名前が長すぎると、置き場のパスが OS の上限を超える。
const NAME_MAX: usize = 100;

/// OS がそのまま実行するファイルの拡張子。アーカイブの中のものは既定のアプリで開かせない。
const EXECUTABLE: &[&str] = &[
    "app",
    "appimage",
    "appinstaller",
    "application",
    "appx",
    "appxbundle",
    "bash",
    "bat",
    "cmd",
    "com",
    "command",
    "cpl",
    "csh",
    "deb",
    "desktop",
    "dll",
    "dmg",
    "exe",
    "fish",
    "gadget",
    "hta",
    "inf",
    "ins",
    "jar",
    "js",
    "jse",
    "ksh",
    "lnk",
    "msc",
    "msh",
    "msi",
    "msix",
    "msixbundle",
    "msp",
    "mst",
    "pif",
    "pkg",
    "pl",
    "ps1",
    "ps1xml",
    "ps2",
    "ps2xml",
    "psc1",
    "psc2",
    "psm1",
    "py",
    "pyw",
    "rb",
    "reg",
    "rpm",
    "run",
    "scf",
    "scr",
    "sct",
    "settingcontent-ms",
    "sh",
    "shb",
    "shs",
    "vb",
    "vbe",
    "vbs",
    "workflow",
    "ws",
    "wsc",
    "wsf",
    "wsh",
    "zsh",
];

pub(crate) fn is_executable(ext: &str) -> bool {
    EXECUTABLE.contains(&ext)
}

pub(crate) fn dir_for(cache: &Path, root: &Path) -> PathBuf {
    cache
        .join("archives")
        .join(hex(&[root.as_os_str().as_encoded_bytes()]))
}

fn hex(parts: &[&[u8]]) -> String {
    format!("{:016x}", thumb::fnv(parts))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    pub(crate) path: String,
    pub(crate) size: u64,
    pub(crate) encrypted: bool,
    /// .gz のように中身に名前がない。path はアーカイブの名前から作ったもの。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) unnamed: bool,
}

impl Entry {
    fn inner_path(&self) -> String {
        if self.unnamed {
            String::new()
        } else {
            self.path.clone()
        }
    }

    pub(crate) fn name(&self) -> &str {
        self.path.rsplit('/').next().unwrap_or(&self.path)
    }

    pub(crate) fn ext(&self) -> String {
        Path::new(self.name())
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or_default()
            .to_lowercase()
    }
}

/// ファイル名に使える形にする。使えない名前は、拡張子だけを残した名前にする。
fn safe_name(e: &Entry) -> String {
    let name = e.name();
    if name.chars().count() <= NAME_MAX && library::check_name(name).is_ok() {
        return name.to_owned();
    }
    let ext = e.ext();
    if !ext.is_empty() && ext.len() <= 16 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        format!("file.{ext}")
    } else {
        "file".into()
    }
}

fn io_error(path: &Path) -> impl Fn(std::io::Error) -> String + '_ {
    move |e| format!("{}: {e}", path.display())
}

fn size_of(dir: &Path) -> u64 {
    let Ok(rd) = fs::read_dir(dir) else {
        return 0;
    };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => size_of(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// 使った順は目次の更新日時で見る。
fn last_used(dir: &Path) -> SystemTime {
    fs::metadata(dir.join(ENTRIES))
        .and_then(|m| m.modified())
        .unwrap_or(UNIX_EPOCH)
}

/// 置き場が大きくなりすぎたら、使っていないアーカイブのものから消す。keep は使っている最中なので残す。
fn trim(base: &Path, keep: &Path) {
    let Ok(rd) = fs::read_dir(base) else {
        return;
    };
    let mut dirs: Vec<(PathBuf, SystemTime, u64)> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .map(|p| {
            let (used, size) = (last_used(&p), size_of(&p));
            (p, used, size)
        })
        .collect();
    let mut total: u64 = dirs.iter().map(|d| d.2).sum();
    dirs.sort_by_key(|d| d.1);
    for (dir, _, size) in dirs {
        if total <= CAPACITY {
            break;
        }
        if dir == keep {
            continue;
        }
        match fs::remove_dir_all(&dir) {
            Ok(()) => total -= size,
            Err(e) => log::warn!("取り出したファイルを消せない: {}: {e}", dir.display()),
        }
    }
}

/// 1 つのファイルのサムネイルと波形の置き場所。
#[derive(Clone)]
pub(crate) struct ThumbFiles {
    /// プラグインが作ったもの。音声ならジャケット
    pub(crate) png: PathBuf,
    /// プラグインが作らないと答えた印
    pub(crate) none: PathBuf,
    pub(crate) wave: PathBuf,
    /// 波形から描いたもの
    pub(crate) drawn: PathBuf,
}

pub(crate) struct Shown {
    pub(crate) file: PathBuf,
    pub(crate) size: (u32, u32),
    pub(crate) wave: bool,
}

impl ThumbFiles {
    pub(crate) fn shown(&self) -> Option<Shown> {
        [(&self.png, false), (&self.drawn, true)]
            .into_iter()
            .find_map(|(file, wave)| {
                let s = imagesize::size(file).ok()?;
                Some(Shown {
                    file: file.clone(),
                    size: (s.width as u32, s.height as u32),
                    wave,
                })
            })
    }
}

/// 1 つのアーカイブと、その置き場。
#[derive(Clone)]
pub(crate) struct Place {
    pub(crate) src: PathBuf,
    pub(crate) ext: String,
    base: PathBuf,
    dir: PathBuf,
}

impl Place {
    pub(crate) fn new(base: &Path, id: &str, src: &Path, ext: &str) -> Result<Place, String> {
        let m = fs::metadata(src).map_err(io_error(src))?;
        let stamp = m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis());
        let version = hex(&[&stamp.to_le_bytes(), &m.len().to_le_bytes()]);
        Ok(Place {
            src: src.to_owned(),
            ext: ext.to_owned(),
            base: base.to_owned(),
            dir: base.join(format!("{}-{version}", hex(&[id.as_bytes()]))),
        })
    }

    fn entries_path(&self) -> PathBuf {
        self.dir.join(ENTRIES)
    }

    fn cached_entries(&self) -> Option<Vec<Entry>> {
        let path = self.entries_path();
        let list = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
        if let Err(e) = fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .and_then(|f| f.set_modified(SystemTime::now()))
        {
            log::warn!("使った時刻を残せない: {}: {e}", path.display());
        }
        Some(list)
    }

    /// 目次。一度読んだものは置き場から返す。
    pub(crate) fn entries(&self, runner: &mut Runner) -> Result<Vec<Entry>, String> {
        if let Some(list) = self.cached_entries() {
            return Ok(list);
        }
        let list = runner
            .archive_entries(&self.ext, &self.src)
            .ok_or_else(|| {
                format!("「.{}」の内容を読み取れるプラグインがありません", self.ext)
            })??;
        let stem = self
            .src
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
            .to_owned();
        let list: Vec<Entry> = list
            .into_iter()
            .map(|e| Entry {
                unnamed: e.path.is_empty(),
                path: if e.path.is_empty() {
                    stem.clone()
                } else {
                    e.path
                },
                size: e.size,
                encrypted: e.encrypted,
            })
            .collect();
        fs::create_dir_all(&self.dir).map_err(io_error(&self.dir))?;
        let json = serde_json::to_vec(&list).map_err(|e| e.to_string())?;
        library::write_file(&self.entries_path(), json)?;
        Ok(list)
    }

    fn check_room(&self, size: u64) -> Result<(), String> {
        if size > ENTRY_MAX {
            return Err(format!(
                "ファイルが大きすぎるため開けません（{} GB まで）",
                ENTRY_MAX >> 30
            ));
        }
        fs::create_dir_all(&self.dir).map_err(io_error(&self.dir))?;
        let free = fs4::available_space(&self.dir).map_err(io_error(&self.dir))?;
        if free < size.saturating_add(MARGIN) {
            return Err("空き容量が足りないため開けません".into());
        }
        Ok(())
    }

    fn work_dir(&self, job: u32) -> PathBuf {
        self.dir.join(WORK).join(job.to_string())
    }

    /// 取り出した実ファイルの場所。なければ取り出す。
    pub(crate) fn extract(
        &self,
        runner: &mut Runner,
        e: &Entry,
        job: u32,
    ) -> Result<PathBuf, String> {
        if e.encrypted {
            return Err("パスワード付きのファイルは開けません".into());
        }
        let name = safe_name(e);
        let out = self
            .dir
            .join(FILES)
            .join(hex(&[e.path.as_bytes()]))
            .join(&name);
        if out.is_file() {
            return Ok(out);
        }
        self.check_room(e.size)?;
        let work = self.work_dir(job);
        fs::create_dir_all(&work).map_err(io_error(&work))?;
        let tmp = work.join(&name);
        let placed = fs::File::create(&tmp)
            .map_err(io_error(&tmp))
            .and_then(|_| {
                if e.size == 0 {
                    return Ok(());
                }
                runner.archive_extract(
                    &self.ext,
                    &self.src,
                    &[ArchiveOut {
                        path: e.inner_path(),
                        file: tmp.clone(),
                        size: e.size,
                    }],
                    None,
                )
            })
            .and_then(|()| {
                let parent = out.parent().ok_or("取り出し先が不正です")?;
                fs::create_dir_all(parent).map_err(io_error(parent))?;
                match fs::rename(&tmp, &out) {
                    Err(_) if out.is_file() => Ok(()),
                    r => r.map_err(io_error(&out)),
                }
            });
        let _ = fs::remove_dir_all(&work);
        placed?;
        trim(&self.base, &self.dir);
        Ok(out)
    }

    pub(crate) fn wave_path(&self, path: &str) -> PathBuf {
        self.dir
            .join(THUMBS)
            .join(format!("{}.wave", hex(&[path.as_bytes()])))
    }

    /// owner はサムネイルを作るプラグインの ID とバージョン。更新されたら作り直す。
    pub(crate) fn thumb_files(&self, e: &Entry, edge: u32, owner: &str) -> ThumbFiles {
        let dir = self.dir.join(THUMBS);
        let made = format!("{}-{edge}", hex(&[e.path.as_bytes(), owner.as_bytes()]));
        ThumbFiles {
            png: dir.join(format!("{made}.png")),
            none: dir.join(format!("{made}.none")),
            wave: self.wave_path(&e.path),
            drawn: dir.join(format!("{}-{edge}.wave.png", hex(&[e.path.as_bytes()]))),
        }
    }

    /// サムネイルのために取り出す作業用のファイルを、空で用意する。held は同時に置いておくファイルの数。
    pub(crate) fn thumb_outputs(
        &self,
        entries: &[&Entry],
        held: usize,
        job: u32,
    ) -> Result<Vec<ArchiveOut>, String> {
        let mut sizes: Vec<u64> = entries.iter().map(|e| e.size).collect();
        sizes.sort_unstable_by(|a, b| b.cmp(a));
        self.check_room(sizes.iter().take(held).sum())?;
        let work = self.work_dir(job);
        fs::create_dir_all(&work).map_err(io_error(&work))?;
        entries
            .iter()
            .enumerate()
            .map(|(i, e)| {
                let file = work.join(format!("{i}.{}", e.ext()));
                fs::File::create(&file).map_err(io_error(&file))?;
                Ok(ArchiveOut {
                    path: e.inner_path(),
                    file,
                    size: e.size,
                })
            })
            .collect()
    }

    pub(crate) fn end_work(&self, job: u32) {
        let _ = fs::remove_dir_all(self.work_dir(job));
    }
}
