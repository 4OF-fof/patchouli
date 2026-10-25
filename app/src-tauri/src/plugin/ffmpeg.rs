//! 手元の FFmpeg。同梱はせず、PATH にあれば使う。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;

/// 1 回の呼び出しで待つ長さ。
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
pub struct Found {
    pub path: PathBuf,
    pub version: String,
}

/// 見つけた FFmpeg。最初に呼んだときに一度だけ探す。
pub fn find() -> Option<&'static Found> {
    static FOUND: OnceLock<Option<Found>> = OnceLock::new();
    FOUND.get_or_init(search).as_ref()
}

fn search() -> Option<Found> {
    // OS の機能で代わりにする動きを確かめるとき
    if cfg!(debug_assertions) && std::env::var_os("PATCHOULI_NO_FFMPEG").is_some() {
        return None;
    }
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let path = std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(name))
        .find(|p| p.is_file())?;
    let out = command(&path).arg("-version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let version = text
        .lines()
        .next()?
        .strip_prefix("ffmpeg version ")?
        .split_whitespace()
        .next()?
        .to_owned();
    log::info!("FFmpeg {version}: {}", path.display());
    Some(Found { path, version })
}

fn command(path: &Path) -> Command {
    let mut c = Command::new(path);
    c.stdin(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 黒い窓を出さない
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// at 秒目のコマを、長いほうの辺が edge 以下の PNG にする。
pub fn frame(ff: &Found, src: &Path, at: f64, edge: u32) -> Result<Vec<u8>, String> {
    let scale =
        format!("scale='min({edge},iw)':'min({edge},ih)':force_original_aspect_ratio=decrease");
    let mut child = command(&ff.path)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-nostdin",
            "-ss",
            &format!("{at:.3}"),
            "-i",
        ])
        .arg(src)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &scale,
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "-",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg を動かせない: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("FFmpeg の出力を受け取れない")?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        stdout.read_to_end(&mut buf).map(|_| buf)
    });
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("FFmpeg が {} 秒で終わらない", TIMEOUT.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let png = reader
        .join()
        .map_err(|_| "FFmpeg の出力を読めない".to_owned())?
        .map_err(|e| e.to_string())?;
    if !status.success() || png.is_empty() {
        return Err(format!("{}: コマを取り出せない", src.display()));
    }
    Ok(png)
}
