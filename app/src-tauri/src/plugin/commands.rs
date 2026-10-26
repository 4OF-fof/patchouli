//! プラグインが plugin.json の required / optional に書いた、手元のコマンド（FFmpeg など）。同梱はせず、PATH にあれば使う。

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// 1 回の呼び出しで待つ長さ。プラグインが指定しなかったときに使う。
pub const TIMEOUT: Duration = Duration::from_secs(30);

/// コマンドの名前に使えるのは、英数字と「. _ + -」だけ（パスは書けない）。
pub fn valid(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b))
        && name
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphanumeric())
}

/// PATH から name を探す。Windows では .exe と .com を足して探す。
pub fn find(name: &str) -> Option<PathBuf> {
    if !valid(name) {
        return None;
    }
    // 見つからないときの動きを確かめるとき（「ffmpeg,magick」のように並べる）
    #[cfg(debug_assertions)]
    if std::env::var("PATCHOULI_NO_COMMANDS").is_ok_and(|v| v.split(',').any(|n| n == name)) {
        return None;
    }
    let files: Vec<String> = if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.com")]
    } else {
        vec![name.to_owned()]
    };
    std::env::split_paths(&std::env::var_os("PATH")?)
        .flat_map(|d| files.iter().map(move |f| d.join(f)))
        .find(|p| p.is_file())
}

/// コマンドが終わったときの結果。
pub struct Output {
    /// 終わったときの番号。止めたときなどはない。
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

fn drain(r: Option<impl Read + Send + 'static>) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = r {
            let _ = r.read_to_end(&mut buf);
        }
        buf
    })
}

/// path を args で動かす。標準入力は空にし、timeout で終わらなければ止める。
pub fn run(path: &Path, args: &[OsString], timeout: Duration) -> Result<Output, String> {
    let name = path
        .file_stem()
        .map_or_else(String::new, |s| s.to_string_lossy().into_owned());
    let mut c = Command::new(path);
    c.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 黒い窓を出さない
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = c
        .spawn()
        .map_err(|e| format!("外部ツール「{name}」の実行に失敗しました：{e}"))?;
    // 出力が詰まって止まらないよう、どちらも別のスレッドで読み続ける
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(s);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let stdout = stdout
        .join()
        .map_err(|_| format!("外部ツール「{name}」の出力の読み込みに失敗しました"))?;
    let stderr = stderr
        .join()
        .map_err(|_| format!("外部ツール「{name}」の出力の読み込みに失敗しました"))?;
    if status.is_none() {
        return Err(format!(
            "外部ツール「{name}」が {} 秒以内に終了しませんでした",
            timeout.as_secs_f64()
        ));
    }
    Ok(Output {
        code: status.and_then(|s| s.code()),
        stdout,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}
