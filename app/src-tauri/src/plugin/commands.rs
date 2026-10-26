//! プラグインが plugin.json の required / optional に書いた、手元のコマンド（FFmpeg など）。同梱はせず、PATH にあれば使う。

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// コマンドの版の取り方。args で動かし、出力（標準出力と標準エラー）から pattern で版を拾う。
/// pattern にグループがあれば最初のグループ、なければ合ったところ全体を版にする。
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Probe {
    #[serde(default)]
    pub args: Vec<String>,
    pub pattern: String,
}

/// 求めるコマンド 1 つ。min を書くときは、version に版の取り方も書く。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CommandDep {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Probe>,
}

/// 求めるコマンドが使えないわけ。
pub enum Unmet {
    Missing,
    /// 見つけた版が古い。
    Old(String),
    /// 版を確かめられない。
    Unknown(String),
}

/// name を探し、dep の版の下限を満たしていれば、その場所を返す。
pub fn check(name: &str, dep: &CommandDep) -> Result<PathBuf, Unmet> {
    let path = find(name).ok_or(Unmet::Missing)?;
    let Some(min) = &dep.min else {
        return Ok(path);
    };
    let probe = dep.version.as_ref().ok_or_else(|| {
        Unmet::Unknown("plugin.json にバージョンの取得方法（version）がありません".into())
    })?;
    let found = version_of(&path, probe).map_err(Unmet::Unknown)?;
    if older(&found, min) {
        Err(Unmet::Old(found))
    } else {
        Ok(path)
    }
}

/// path の版を probe で調べる。一度調べたものは覚えておく。
pub fn version_of(path: &Path, probe: &Probe) -> Result<String, String> {
    type Seen = HashMap<(PathBuf, Probe), Result<String, String>>;
    static SEEN: OnceLock<Mutex<Seen>> = OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashMap::new()));
    let key = (path.to_owned(), probe.clone());
    if let Some(r) = seen.lock().ok().and_then(|s| s.get(&key).cloned()) {
        return r;
    }
    let r = probe_version(path, probe);
    if let Ok(mut s) = seen.lock() {
        s.insert(key, r.clone());
    }
    r
}

fn probe_version(path: &Path, probe: &Probe) -> Result<String, String> {
    let re = regex::Regex::new(&probe.pattern)
        .map_err(|e| format!("バージョンを取り出す正規表現が正しくありません：{e}"))?;
    let args: Vec<OsString> = probe.args.iter().map(OsString::from).collect();
    let out = run(path, &args, TIMEOUT)?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), out.stderr);
    let c = re
        .captures(&text)
        .ok_or("出力からバージョンが見つかりません")?;
    Ok(c.get(1)
        .or_else(|| c.get(0))
        .map_or("", |m| m.as_str())
        .to_owned())
}

/// 版 a が b より古いか。「.」で区切った数字を前から比べる（数字の前後の文字は見ない）。
pub fn older(a: &str, b: &str) -> bool {
    let parts = |s: &str| -> Vec<u64> {
        s.split('.')
            .map(|p| {
                let digits: String = p
                    .trim_start_matches(|c: char| !c.is_ascii_digit())
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect();
                digits.parse().unwrap_or(0)
            })
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(i).copied().unwrap_or(0),
            b.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x < y;
        }
    }
    false
}

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
