//! llama.cpp とモデルをダウンロードする。版とハッシュは固定し、途中で切れたら続きから読む。

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::{dir, exe, models};

struct Asset {
    url: &'static str,
    name: &'static str,
    size: u64,
    sha256: &'static str,
}

const LLAMA_BUILD: &str = "b12020";

macro_rules! llama {
    ($file:literal, $size:literal, $sha:literal) => {
        Asset {
            url: concat!(
                "https://github.com/ggml-org/llama.cpp/releases/download/b12020/",
                $file
            ),
            name: $file,
            size: $size,
            sha256: $sha,
        }
    };
}

#[cfg(all(windows, target_arch = "x86_64"))]
const LLAMA: Asset = llama!(
    "llama-b12020-bin-win-vulkan-x64.zip",
    37515077,
    "aa3452dfa16cdf7d902b44e5445e43e13023c64fb179ca7a13d60611d4371691"
);
#[cfg(all(windows, target_arch = "aarch64"))]
const LLAMA: Asset = llama!(
    "llama-b12020-bin-win-vulkan-arm64.zip",
    25593820,
    "d93e464293c10192035fcb40e002e7b2a6333c204771e86030f43721596f744a"
);
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const LLAMA: Asset = llama!(
    "llama-b12020-bin-ubuntu-vulkan-x64.tar.gz",
    35664875,
    "8b7ec1fbef304ea4e024cf34f68ef1276556b38b666dc71b8af5de6e9d93b42c"
);
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const LLAMA: Asset = llama!(
    "llama-b12020-bin-ubuntu-vulkan-arm64.tar.gz",
    28986505,
    "e4db03071cffa07d3ff278cc39545db7ae729fa6ca907fc96af3f01a70272b30"
);
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const LLAMA: Asset = llama!(
    "llama-b12020-bin-macos-arm64.tar.gz",
    16509249,
    "b630ebd5da34b02e86f7294dd5743aba842a0a02cb023130debd64599721c541"
);
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const LLAMA: Asset = llama!(
    "llama-b12020-bin-macos-x64.tar.gz",
    12248997,
    "774fba46a668cf6c94eb8d515b2dfb5897878ab6da08943585f487a1dd1aa6a0"
);

const MODELS: [Asset; 2] = [
    Asset {
        url: "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/6ea3e3a309d12a4779cfda98b8c19800d2d5da71/embeddinggemma-2-Q8_0.gguf",
        name: super::MODEL_FILE,
        size: 309855456,
        sha256: "2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135",
    },
    Asset {
        url: "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/6ea3e3a309d12a4779cfda98b8c19800d2d5da71/mmproj-embeddinggemma-2-Q8_0.gguf",
        name: super::MMPROJ_FILE,
        size: 554821056,
        sha256: "0531309472a6bc6f4b146c3736eee7795ec9db1903c25490d3c937490cef6dd8",
    },
];

/// 展開したあとの大きさの見込み。圧縮した大きさの何倍か。
const UNPACKED: u64 = 4;
const MARGIN: u64 = 64 << 20;

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

pub struct Progress<'a> {
    pub file: &'a str,
    pub done: u64,
    pub total: u64,
}

pub fn downloading() -> bool {
    BUSY.load(Ordering::Relaxed)
}

pub fn cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

fn part_of(to: &Path) -> PathBuf {
    let mut name = to.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    to.with_file_name(name)
}

fn llama_archive() -> PathBuf {
    dir().join(LLAMA.name)
}

/// まだダウンロードしていないもの（ダウンロードした先と、もの）。
fn missing() -> Vec<(PathBuf, &'static Asset)> {
    let mut out = Vec::new();
    if !exe().is_file() {
        out.push((llama_archive(), &LLAMA));
    }
    for m in &MODELS {
        let to = models().join(m.name);
        if !to.is_file() {
            out.push((to, m));
        }
    }
    out
}

/// これからダウンロードする大きさ。途中まで読んだものは、その分を引く。
pub fn need() -> u64 {
    missing()
        .iter()
        .map(|(to, a)| {
            let have = fs::metadata(part_of(to)).map_or(0, |m| m.len());
            a.size.saturating_sub(have)
        })
        .sum()
}

/// 空き容量を調べられるよう、いちばん近くにある親のフォルダ。
fn existing(mut p: &Path) -> &Path {
    while !p.exists() {
        match p.parent() {
            Some(q) => p = q,
            None => break,
        }
    }
    p
}

struct Busy;

impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Relaxed);
    }
}

/// ないものをダウンロードし、llama.cpp は展開する。
pub fn install(progress: &mut dyn FnMut(Progress)) -> Result<(), String> {
    if BUSY.swap(true, Ordering::Relaxed) {
        return Err("ダウンロード中です".into());
    }
    let _busy = Busy;
    CANCEL.store(false, Ordering::Relaxed);
    let todo = missing();
    let mut room = need() + MARGIN;
    if !exe().is_file() {
        room += LLAMA.size * UNPACKED;
    }
    let free = fs4::available_space(existing(&dir())).map_err(|e| e.to_string())?;
    if free < room {
        return Err(format!(
            "空き容量が足りません（必要な容量：{} MB）",
            room.div_ceil(1 << 20)
        ));
    }
    for (to, a) in todo {
        download(a, &to, progress)?;
        if std::ptr::eq(a, &LLAMA) {
            unpack(&to, &dir().join("llama"))?;
            let _ = fs::remove_file(&to);
        }
    }
    Ok(())
}

fn download(a: &Asset, to: &Path, progress: &mut dyn FnMut(Progress)) -> Result<(), String> {
    let failed = |e: &dyn std::fmt::Display| {
        format!("ファイル「{}」のダウンロードに失敗しました：{e}", a.name)
    };
    if let Some(d) = to.parent() {
        fs::create_dir_all(d).map_err(|e| failed(&e))?;
    }
    let part = part_of(to);
    let mut have = fs::metadata(&part).map_or(0, |m| m.len());
    if have > a.size {
        fs::remove_file(&part).map_err(|e| failed(&e))?;
        have = 0;
    }
    if have < a.size {
        // 大きいので全体の長さは区切らず、止まったときに CANCEL を見に戻れるよう、読むごとに区切る
        let mut req = ureq::get(a.url)
            .config()
            .timeout_connect(Some(Duration::from_secs(30)))
            .timeout_per_read(Some(Duration::from_secs(30)))
            .build();
        if have > 0 {
            req = req.header("Range", format!("bytes={have}-"));
        }
        let res = req.call().map_err(|e| failed(&e))?;
        let mut out = if res.status() == 206 {
            fs::OpenOptions::new().append(true).open(&part)
        } else {
            have = 0;
            File::create(&part)
        }
        .map_err(|e| failed(&e))?;
        let mut r = res.into_body().into_reader();
        let mut buf = vec![0u8; 1 << 20];
        let mut told = Instant::now();
        loop {
            if CANCEL.load(Ordering::Relaxed) {
                return Err("ダウンロードをキャンセルしました".into());
            }
            let n = r.read(&mut buf).map_err(|e| failed(&e))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| failed(&e))?;
            have += n as u64;
            if told.elapsed() > Duration::from_millis(200) {
                told = Instant::now();
                progress(Progress {
                    file: a.name,
                    done: have,
                    total: a.size,
                });
            }
        }
    }
    let mut h = Sha256::new();
    let mut f = File::open(&part).map_err(|e| failed(&e))?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| failed(&e))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    let got: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if got != a.sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!("ファイル「{}」のハッシュが一致しません", a.name));
    }
    fs::rename(&part, to).map_err(|e| failed(&e))
}

/// 中のフォルダはなくし、ファイルを to にじかに並べる。展開し終えてから置き換える。
fn unpack(archive: &Path, to: &Path) -> Result<(), String> {
    let tmp = to.with_extension("tmp");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    extract(archive, &tmp).map_err(|e| format!("llama.cpp の展開に失敗しました：{e}"))?;
    let _ = fs::remove_dir_all(to);
    fs::rename(&tmp, to).map_err(|e| e.to_string())?;
    log::info!("llama.cpp {LLAMA_BUILD} を展開した");
    Ok(())
}

#[cfg(windows)]
fn extract(archive: &Path, to: &Path) -> Result<(), String> {
    let f = File::open(archive).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| e.to_string())?;
        if e.is_dir() {
            continue;
        }
        let Some(name) = e
            .enclosed_name()
            .and_then(|p| p.file_name().map(PathBuf::from))
        else {
            continue;
        };
        let mut out = File::create(to.join(name)).map_err(|e| e.to_string())?;
        std::io::copy(&mut e, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn extract(archive: &Path, to: &Path) -> Result<(), String> {
    let f = File::open(archive).map_err(|e| e.to_string())?;
    let mut t = tar::Archive::new(flate2::read::GzDecoder::new(f));
    for e in t.entries().map_err(|e| e.to_string())? {
        let mut e = e.map_err(|e| e.to_string())?;
        let path = e.path().map_err(|e| e.to_string())?.into_owned();
        let Some(name) = path.file_name().map(PathBuf::from) else {
            continue;
        };
        let kind = e.header().entry_type();
        if kind.is_symlink() {
            // 共有ライブラリの版の付いた名前への別名。中のフォルダをなくすので、名前だけにする
            let Some(target) = e
                .link_name()
                .map_err(|e| e.to_string())?
                .and_then(|l| l.file_name().map(PathBuf::from))
            else {
                continue;
            };
            std::os::unix::fs::symlink(target, to.join(name)).map_err(|e| e.to_string())?;
        } else if kind.is_file() {
            e.unpack(to.join(name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
