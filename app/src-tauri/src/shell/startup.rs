//! ログイン時の自動起動。状態は OS の登録をそのまま使う。

/// 自動起動を扱えない OS では None を返す。
#[tauri::command]
pub(crate) async fn startup_enabled() -> Option<bool> {
    platform::enabled()
}

#[tauri::command]
pub(crate) async fn set_startup(on: bool) -> Result<(), String> {
    platform::set(on)
}

#[cfg(windows)]
mod platform {
    use std::io::ErrorKind;

    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};

    use crate::shell::tray::BACKGROUND;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    // 開発版の登録でインストール版の登録を上書きしない
    const NAME: &str = if cfg!(debug_assertions) {
        "Patchouli Dev"
    } else {
        "Patchouli"
    };

    fn command() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        Ok(format!("\"{}\" {BACKGROUND}", exe.display()))
    }

    pub fn enabled() -> Option<bool> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let command = command().ok();
        let registered = hkcu
            .open_subkey(RUN)
            .and_then(|k| k.get_value::<String, _>(NAME))
            .is_ok_and(|v| command.is_some_and(|c| v.eq_ignore_ascii_case(&c)));
        // タスクマネージャーで無効にすると先頭のバイトが奇数になる
        let approved = hkcu
            .open_subkey(APPROVED)
            .and_then(|k| k.get_raw_value(NAME))
            .map_or(true, |v| v.bytes.first().is_none_or(|b| b & 1 == 0));
        Some(registered && approved)
    }

    pub fn set(on: bool) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        // タスクマネージャーで無効にした記録が残っていると Run に書いても起動しない
        if let Ok(k) = hkcu.open_subkey_with_flags(APPROVED, KEY_SET_VALUE) {
            let _ = k.delete_value(NAME);
        }
        let (run, _) = hkcu.create_subkey(RUN).map_err(fail)?;
        if on {
            return run.set_value(NAME, &command()?).map_err(fail);
        }
        match run.delete_value(NAME) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(fail(e)),
            _ => Ok(()),
        }
    }

    fn fail(e: std::io::Error) -> String {
        format!("スタートアップの設定の変更に失敗しました：{e}")
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn enabled() -> Option<bool> {
        None
    }

    pub fn set(_on: bool) -> Result<(), String> {
        Err("この OS ではスタートアップの設定を変更できません".into())
    }
}
