//! ファイルを、OS のファイルマネージャーや既定のアプリで開く。

use std::path::Path;
use std::process::Command;

/// path を選んだ状態で、入っているフォルダを開く。
pub fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let c = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("explorer");
        c.raw_arg(format!("/select,\"{}\"", path.display()));
        c
    };
    #[cfg(target_os = "macos")]
    let c = {
        let mut c = Command::new("open");
        c.arg("-R").arg(path);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let c = {
        let mut c = Command::new("xdg-open");
        c.arg(path.parent().unwrap_or(path));
        c
    };
    spawn(c, path)
}

/// path を、その形式の既定のアプリで開く。
pub fn open(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let name = "explorer";
    #[cfg(target_os = "macos")]
    let name = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let name = "xdg-open";
    let mut c = Command::new(name);
    c.arg(path);
    spawn(c, path)
}

/// 終わるのは待たない（explorer は開けても 0 以外で終わることがある）。
fn spawn(mut c: Command, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("{} が見つかりません", path.display()));
    }
    c.spawn()
        .map(drop)
        .map_err(|e| format!("{}: {e}", path.display()))
}
