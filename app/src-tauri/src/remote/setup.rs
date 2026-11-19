//! CLI を PATH に登録し、skill を書き出し、拡張機能から呼べるよう Native Messaging のホストを登録する。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::remote::proto::{self, HOST};
use crate::shell::settings;

const CLI: &str = if cfg!(windows) {
    "patchouli-cli.exe"
} else {
    "patchouli-cli"
};
/// PATH に置くコマンドの名前。
const COMMAND: &str = if cfg!(windows) {
    "patchouli.exe"
} else {
    "patchouli"
};
/// CLI の写しの隣に置く、アプリの場所を書いたファイル。CLI がアプリを起動するときに読む。
const APP_PATH: &str = "app-path";
const SKILL: &str = include_str!("SKILL.md");
const SKILL_DIR: &str = "patchouli";
const SKILL_FILE: &str = "SKILL.md";
/// 登録しなくても接続できる拡張機能。Firefox 版クリッパーの ID。
const BUILT_IN_EXTENSIONS: &[&str] = &["patchouli-clipper@4of.dev"];

fn err(p: &Path) -> impl Fn(std::io::Error) -> String + '_ {
    move |e| format!("{}: {e}", p.display())
}

/// アプリと一緒に入れた CLI。
pub fn cli() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let p = exe.parent()?.join(CLI);
    p.is_file().then(|| crate::library::dunce(p))
}

fn need_cli() -> Result<PathBuf, String> {
    cli().ok_or_else(|| format!("CLI（{CLI}）が見つかりません"))
}

fn home(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|e| e.to_string())
}

/// PATH に足すフォルダ。Windows はアプリのフォルダごと PATH に入れずに済むよう、CLI だけを写す。
pub fn path_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(windows) {
        Ok(app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("bin"))
    } else {
        Ok(home(app)?.join(".local").join("bin"))
    }
}

pub fn command(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(path_dir(app)?.join(COMMAND))
}

pub fn set_path(app: &AppHandle, on: bool) -> Result<(), String> {
    let dir = path_dir(app)?;
    if on {
        place_command(app, &need_cli()?)?;
        #[cfg(windows)]
        windows::add_path(&dir)?;
    } else {
        #[cfg(windows)]
        windows::remove_path(&dir)?;
        remove_command(app)?;
    }
    settings::update_remote(app, |r| {
        r.path = on;
        Ok(())
    })?;
    // skill に書くコマンドの呼び方が変わる
    refresh_skills(app)
}

#[cfg(windows)]
fn place_command(app: &AppHandle, cli: &Path) -> Result<(), String> {
    let dir = path_dir(app)?;
    fs::create_dir_all(&dir).map_err(err(&dir))?;
    let to = dir.join(COMMAND);
    let same = |a: &Path, b: &Path| {
        let (Ok(a), Ok(b)) = (fs::metadata(a), fs::metadata(b)) else {
            return false;
        };
        a.len() == b.len() && a.modified().ok() == b.modified().ok()
    };
    if !same(cli, &to) {
        fs::copy(cli, &to).map_err(err(&to))?;
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let at = dir.join(APP_PATH);
    fs::write(&at, exe.to_string_lossy().as_bytes()).map_err(err(&at))
}

#[cfg(not(windows))]
fn place_command(app: &AppHandle, cli: &Path) -> Result<(), String> {
    let dir = path_dir(app)?;
    fs::create_dir_all(&dir).map_err(err(&dir))?;
    let to = dir.join(COMMAND);
    match fs::read_link(&to) {
        Ok(p) if p == cli => return Ok(()),
        Ok(_) => fs::remove_file(&to).map_err(err(&to))?,
        Err(_) if to.exists() => return Err(format!("{} はすでに存在します", to.display())),
        Err(_) => {}
    }
    std::os::unix::fs::symlink(cli, &to).map_err(err(&to))
}

fn remove_command(app: &AppHandle) -> Result<(), String> {
    let dir = path_dir(app)?;
    let to = dir.join(COMMAND);
    if cfg!(windows) {
        for p in [to, dir.join(APP_PATH)] {
            if p.exists() {
                fs::remove_file(&p).map_err(err(&p))?;
            }
        }
        let _ = fs::remove_dir(&dir);
    } else if fs::read_link(&to).is_ok() {
        fs::remove_file(&to).map_err(err(&to))?;
    }
    Ok(())
}

#[cfg(windows)]
mod windows {
    use std::path::Path;

    use winreg::RegKey;
    use winreg::RegValue;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, RegType};

    const ENV: &str = "Environment";

    fn read(key: &RegKey) -> (String, RegType) {
        match key.get_raw_value("Path") {
            Ok(v) => {
                let wide: Vec<u16> = v
                    .bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                let s = String::from_utf16_lossy(&wide);
                (s.trim_end_matches('\0').to_owned(), v.vtype)
            }
            Err(_) => (String::new(), RegType::REG_EXPAND_SZ),
        }
    }

    fn write(key: &RegKey, s: &str, vtype: RegType) -> Result<(), String> {
        let bytes: Vec<u8> = s
            .encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect();
        key.set_raw_value(
            "Path",
            &RegValue {
                bytes: bytes.into(),
                vtype,
            },
        )
        .map_err(|e| format!("ユーザーの PATH を書き換えられませんでした：{e}"))?;
        broadcast();
        Ok(())
    }

    fn open() -> Result<RegKey, String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(ENV, KEY_READ | KEY_WRITE)
            .map_err(|e| format!("ユーザーの PATH を読み込めませんでした：{e}"))
    }

    fn same(a: &str, dir: &Path) -> bool {
        a.trim_end_matches('\\')
            .eq_ignore_ascii_case(dir.to_string_lossy().trim_end_matches('\\'))
    }

    pub fn add_path(dir: &Path) -> Result<(), String> {
        let key = open()?;
        let (now, vtype) = read(&key);
        if now.split(';').any(|p| same(p, dir)) {
            return Ok(());
        }
        let next = if now.is_empty() || now.ends_with(';') {
            format!("{now}{}", dir.display())
        } else {
            format!("{now};{}", dir.display())
        };
        write(&key, &next, vtype)
    }

    pub fn remove_path(dir: &Path) -> Result<(), String> {
        let key = open()?;
        let (now, vtype) = read(&key);
        let kept: Vec<&str> = now.split(';').filter(|p| !same(p, dir)).collect();
        let next = kept.join(";");
        if next == now {
            return Ok(());
        }
        write(&key, &next, vtype)
    }

    /// 開いている端末やエクスプローラーに、環境変数が変わったことを知らせる。
    fn broadcast() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
        };
        let name: Vec<u16> = "Environment".encode_utf16().chain([0]).collect();
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                name.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5000,
                std::ptr::null_mut(),
            );
        }
    }

    pub fn set_host(keys: &[&str], host: &str, manifest: Option<&Path>) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for k in keys {
            let path = format!(r"{k}\NativeMessagingHosts\{host}");
            match manifest {
                Some(m) => {
                    let (key, _) = hkcu
                        .create_subkey(&path)
                        .map_err(|e| format!(r"HKCU\{path}: {e}"))?;
                    key.set_value("", &m.to_string_lossy().into_owned())
                        .map_err(|e| format!(r"HKCU\{path}: {e}"))?;
                }
                None => {
                    let _ = hkcu.delete_subkey_all(&path);
                }
            }
        }
        Ok(())
    }
}

/// Chromium 系の拡張機能の ID は、a〜p の 32 文字。
pub fn chromium_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

pub fn valid_extension(id: &str) -> bool {
    chromium_id(id)
        || (!id.is_empty()
            && id.len() <= 200
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "@.-_{}".contains(c)))
}

/// 接続を認める拡張機能。組み込みの ID と、設定で登録した ID。
pub fn allowed_extensions(app: &AppHandle) -> Result<Vec<String>, String> {
    let mut ids: Vec<String> = BUILT_IN_EXTENSIONS
        .iter()
        .map(|id| (*id).to_owned())
        .collect();
    for id in settings::remote(app)?.extensions {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

#[derive(Clone, Copy)]
enum Family {
    Chromium,
    Firefox,
}

impl Family {
    fn file(self) -> &'static str {
        match self {
            Family::Chromium => "chromium.json",
            Family::Firefox => "firefox.json",
        }
    }

    #[cfg(windows)]
    fn keys(self) -> &'static [&'static str] {
        match self {
            Family::Chromium => &[
                r"Software\Google\Chrome",
                r"Software\Microsoft\Edge",
                r"Software\Chromium",
                r"Software\BraveSoftware\Brave-Browser",
            ],
            Family::Firefox => &[r"Software\Mozilla"],
        }
    }

    /// ブラウザごとの、ホストの置き場。ブラウザの設定のフォルダがあるものだけを使う。
    #[cfg(not(windows))]
    fn dirs(self, home: &Path) -> Vec<PathBuf> {
        let roots: &[&str] = match (self, cfg!(target_os = "macos")) {
            (Family::Chromium, true) => &[
                "Library/Application Support/Google/Chrome",
                "Library/Application Support/Microsoft Edge",
                "Library/Application Support/Chromium",
                "Library/Application Support/BraveSoftware/Brave-Browser",
            ],
            (Family::Firefox, true) => &["Library/Application Support/Mozilla"],
            (Family::Chromium, false) => &[
                ".config/google-chrome",
                ".config/microsoft-edge",
                ".config/chromium",
                ".config/BraveSoftware/Brave-Browser",
            ],
            (Family::Firefox, false) => &[".mozilla"],
        };
        let sub = match (self, cfg!(target_os = "macos")) {
            (Family::Firefox, false) => "native-messaging-hosts",
            _ => "NativeMessagingHosts",
        };
        roots
            .iter()
            .map(|r| home.join(r))
            .filter(|r| r.is_dir())
            .map(|r| r.join(sub))
            .collect()
    }
}

fn native_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("native-messaging"))
}

/// 接続を認める拡張機能に合わせて、ホストの記述を書き直す。拡張機能がなくなった系統は登録を解除する。
pub fn write_hosts(app: &AppHandle) -> Result<(), String> {
    let ids = allowed_extensions(app)?;
    let dir = native_dir(app)?;
    for family in [Family::Chromium, Family::Firefox] {
        let mine: Vec<&String> = ids
            .iter()
            .filter(|id| chromium_id(id) == matches!(family, Family::Chromium))
            .collect();
        let file = dir.join(family.file());
        if mine.is_empty() {
            register(app, family, None)?;
            if file.exists() {
                fs::remove_file(&file).map_err(err(&file))?;
            }
            continue;
        }
        let mut m = json!({
            "name": HOST,
            "description": "Patchouli",
            "path": need_cli()?,
            "type": "stdio",
        });
        match family {
            Family::Chromium => {
                m["allowed_origins"] = json!(
                    mine.iter()
                        .map(|id| format!("chrome-extension://{id}/"))
                        .collect::<Vec<_>>()
                );
            }
            Family::Firefox => m["allowed_extensions"] = json!(mine),
        }
        fs::create_dir_all(&dir).map_err(err(&dir))?;
        let text = serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?;
        fs::write(&file, text).map_err(err(&file))?;
        register(app, family, Some(&file))?;
    }
    Ok(())
}

#[cfg(windows)]
fn register(_app: &AppHandle, family: Family, manifest: Option<&Path>) -> Result<(), String> {
    windows::set_host(family.keys(), HOST, manifest)
}

#[cfg(not(windows))]
fn register(app: &AppHandle, family: Family, manifest: Option<&Path>) -> Result<(), String> {
    for d in family.dirs(&home(app)?) {
        let to = d.join(format!("{HOST}.json"));
        match manifest {
            Some(m) => {
                fs::create_dir_all(&d).map_err(err(&d))?;
                fs::copy(m, &to).map_err(err(&to))?;
            }
            None if to.exists() => fs::remove_file(&to).map_err(err(&to))?,
            None => {}
        }
    }
    Ok(())
}

pub fn skill_candidates(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let h = home(app)?;
    Ok([".claude", ".codex", ".agents"]
        .iter()
        .map(|d| h.join(d).join("skills"))
        .collect())
}

pub fn skill_installed(dir: &Path) -> bool {
    dir.join(SKILL_DIR).join(SKILL_FILE).is_file()
}

fn skill_text(app: &AppHandle) -> Result<String, String> {
    let r = settings::remote(app)?;
    let command = if r.path {
        "patchouli".to_owned()
    } else {
        let p = need_cli()?.to_string_lossy().into_owned();
        if p.contains(' ') {
            format!("\"{p}\"")
        } else {
            p
        }
    };
    Ok(SKILL
        .replace("{{command}}", &command)
        .replace("{{reference}}", proto::reference(&command).trim_end()))
}

fn write_skill(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let d = dir.join(SKILL_DIR);
    fs::create_dir_all(&d).map_err(err(&d))?;
    let f = d.join(SKILL_FILE);
    fs::write(&f, skill_text(app)?).map_err(err(&f))
}

pub fn install_skill(app: &AppHandle, dir: &Path) -> Result<(), String> {
    write_skill(app, dir)?;
    settings::update_remote(app, |r| {
        if !r.skills.iter().any(|d| d == dir) {
            r.skills.push(dir.to_owned());
        }
        Ok(())
    })
}

pub fn remove_skill(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let d = dir.join(SKILL_DIR);
    let f = d.join(SKILL_FILE);
    if f.exists() {
        fs::remove_file(&f).map_err(err(&f))?;
    }
    let _ = fs::remove_dir(&d);
    settings::update_remote(app, |r| {
        r.skills.retain(|x| x != dir);
        Ok(())
    })
}

fn refresh_skills(app: &AppHandle) -> Result<(), String> {
    for d in settings::remote(app)?.skills {
        if skill_installed(&d) {
            write_skill(app, &d)?;
        }
    }
    Ok(())
}

/// 起動したとき。アプリを更新したあとも、写した CLI・ホストの記述・skill が新しいものになるよう書き直す。
pub fn refresh(app: &AppHandle) {
    let Ok(r) = settings::remote(app) else {
        return;
    };
    if r.path
        && cfg!(windows)
        && let Some(cli) = cli()
        && let Err(e) = place_command(app, &cli)
    {
        log::warn!("PATH に置いた CLI を新しくできない: {e}");
    }
    if let Err(e) = write_hosts(app) {
        log::warn!("Native Messaging のホストを登録し直せない: {e}");
    }
    if let Err(e) = refresh_skills(app) {
        log::warn!("skill を書き直せない: {e}");
    }
}
