//! EmbeddingGemma 2 を llama-server で動かし、区間と文章をベクトルにする。
//! サーバーは使うときに起動し、5 分使わなければ止める。アプリが落ちても残らないよう、
//! Windows ではジョブに入れ、ほかでは標準入力が閉じたら止める sh で包む。

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

use crate::plugin::ExcerptMedia;

pub mod install;

/// ベクトルの鍵に入れるモデルの名前。モデルか、モデルへの渡し方を変えたら変える。
pub const MODEL: &str = "embeddinggemma-2-Q8_0/1";

const MODEL_FILE: &str = "embeddinggemma-2-Q8_0.gguf";
const MMPROJ_FILE: &str = "mmproj-embeddinggemma-2-Q8_0.gguf";

/// 使わないまま、これだけたったら止める。
const IDLE: Duration = Duration::from_secs(300);
const START_LIMIT: Duration = Duration::from_secs(90);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const EMBED_TIMEOUT: Duration = Duration::from_secs(120);

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// llama.cpp とモデルの置き場。開発中は PATCHOULI_EMBED_DIR か example/dev-embed を使う。
pub fn init(app_data: &Path) {
    #[cfg(debug_assertions)]
    let dir = {
        let _ = app_data;
        crate::session::dev_path("PATCHOULI_EMBED_DIR", "dev-embed")
    };
    #[cfg(not(debug_assertions))]
    let dir = app_data.join("embed");
    let _ = DIR.set(dir);
}

fn dir() -> PathBuf {
    DIR.get().cloned().unwrap_or_default()
}

fn exe() -> PathBuf {
    let name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    dir().join("llama").join(name)
}

fn models() -> PathBuf {
    dir().join("models")
}

pub fn installed() -> bool {
    exe().is_file() && models().join(MODEL_FILE).is_file() && models().join(MMPROJ_FILE).is_file()
}

struct Server {
    child: Child,
    port: u16,
    used: Instant,
}

impl Drop for Server {
    fn drop(&mut self) {
        // sh で包んだときは、標準入力を閉じると中の llama-server も止まる
        drop(self.child.stdin.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn server() -> &'static Mutex<Option<Server>> {
    static S: OnceLock<Mutex<Option<Server>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn watch_idle() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        std::thread::spawn(|| {
            loop {
                std::thread::sleep(Duration::from_secs(30));
                if let Ok(mut g) = server().lock()
                    && g.as_ref().is_some_and(|s| s.used.elapsed() > IDLE)
                {
                    log::info!("llama-server を止めた");
                    *g = None;
                }
            }
        });
    });
}

fn quiet(exe: &Path) -> Command {
    let mut c = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 黒い窓を出さない
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.stdin(Stdio::null());
    c
}

/// llama-server が使える GPU の名前。空なら CPU で動かす。
pub fn gpus() -> Result<Vec<String>, String> {
    static FOUND: Mutex<Option<Vec<String>>> = Mutex::new(None);
    let mut g = FOUND.lock().map_err(|e| e.to_string())?;
    if let Some(v) = g.as_ref() {
        return Ok(v.clone());
    }
    let out = quiet(&exe())
        .arg("--list-devices")
        .output()
        .map_err(|e| format!("llama-server の起動に失敗しました：{e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let v: Vec<String> = text
        .lines()
        .skip_while(|l| !l.starts_with("Available devices"))
        .skip(1)
        .filter_map(|l| {
            let (_, name) = l.trim().split_once(": ")?;
            Some(name.split(" (").next().unwrap_or(name).to_owned())
        })
        .collect();
    *g = Some(v.clone());
    Ok(v)
}

#[cfg(windows)]
fn command(exe: &Path) -> Command {
    quiet(exe)
}

/// sh が llama-server を待ち、別のサブシェルが標準入力の終わり（アプリが閉じたか落ちた）で止める。
#[cfg(not(windows))]
fn command(exe: &Path) -> Command {
    let mut c = Command::new("sh");
    c.arg("-c")
        .arg(r#""$0" "$@" & p=$!; (read _; kill $p) & wait $p"#)
        .arg(exe)
        .stdin(Stdio::piped());
    c
}

/// アプリのジョブに入れる。ジョブのハンドルは閉じずに持ち、アプリが終わるとジョブごと止まる。
#[cfg(windows)]
fn bind(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    static JOB: OnceLock<usize> = OnceLock::new();
    let job = *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&info).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 { 0 } else { job as usize }
    });
    if job == 0 || unsafe { AssignProcessToJobObject(job as HANDLE, child.as_raw_handle()) } == 0 {
        log::warn!("llama-server をアプリのジョブに入れられない");
    }
}

#[cfg(not(windows))]
fn bind(_: &Child) {}

fn port() -> Result<u16, String> {
    let mut g = server().lock().map_err(|e| e.to_string())?;
    if let Some(s) = g.as_mut()
        && matches!(s.child.try_wait(), Ok(None))
    {
        s.used = Instant::now();
        return Ok(s.port);
    }
    *g = None;
    if !installed() {
        return Err("llama.cpp かモデルが見つかりません".into());
    }
    watch_idle();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map_err(|e| e.to_string())?
        .port();
    let child = command(&exe())
        .arg("-m")
        .arg(models().join(MODEL_FILE))
        .arg("--mmproj")
        .arg(models().join(MMPROJ_FILE))
        .args(["--embeddings", "-ngl", "99", "-c", "8192", "-ub", "8192"])
        .args(["-b", "8192", "-np", "1", "--image-max-tokens", "280"])
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("llama-server の起動に失敗しました：{e}"))?;
    bind(&child);
    let mut s = Server {
        child,
        port,
        used: Instant::now(),
    };
    let start = Instant::now();
    while ureq::get(format!("http://127.0.0.1:{port}/health"))
        .config()
        .timeout_global(Some(HEALTH_TIMEOUT))
        .build()
        .call()
        .is_err()
    {
        if !matches!(s.child.try_wait(), Ok(None)) {
            return Err("llama-server が途中で終了しました".into());
        }
        if start.elapsed() > START_LIMIT {
            return Err(format!(
                "llama-server の起動が {} 秒以内に終わりませんでした",
                START_LIMIT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    log::info!(
        "llama-server を起動した（{:.1} 秒）",
        start.elapsed().as_secs_f32()
    );
    s.used = Instant::now();
    *g = Some(s);
    Ok(port)
}

/// llama-server を起動し終えるまで待つ。
pub fn warm() -> Result<(), String> {
    port().map(|_| ())
}

pub fn shutdown() {
    if let Ok(mut g) = server().lock() {
        *g = None;
    }
}

pub fn normalize(mut v: Vec<f32>) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
    v.iter_mut().for_each(|x| *x /= n);
    v
}

fn embed(input: Value) -> Result<Vec<f32>, String> {
    let port = port()?;
    let mut res = ureq::post(format!("http://127.0.0.1:{port}/v1/embeddings"))
        .config()
        .timeout_global(Some(EMBED_TIMEOUT))
        .build()
        .send_json(json!({ "model": "embeddinggemma", "input": [input] }))
        .map_err(|e| e.to_string())?;
    let v: Value = res.body_mut().read_json().map_err(|e| e.to_string())?;
    let e = v["data"][0]["embedding"]
        .as_array()
        .ok_or("llama-server からベクトルが返ってきませんでした")?;
    if let Ok(mut g) = server().lock()
        && let Some(s) = g.as_mut()
    {
        s.used = Instant::now();
    }
    Ok(normalize(
        e.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect(),
    ))
}

fn image_part(b: &[u8]) -> Value {
    let mime = if b.starts_with(b"\x89PNG") {
        "image/png"
    } else {
        "image/jpeg"
    };
    json!({ "type": "image_url", "image_url": { "url": format!("data:{mime};base64,{}", STANDARD.encode(b)) } })
}

/// 素材の文章は classification、検索の言葉は search result の書き方で渡す。
pub fn text(task: &str, s: &str) -> Result<Vec<f32>, String> {
    embed(json!(format!("task: {task} | query: {s}")))
}

pub fn image(b: &[u8]) -> Result<Vec<f32>, String> {
    embed(json!({ "content": [image_part(b)] }))
}

pub fn media(m: &ExcerptMedia) -> Result<Vec<f32>, String> {
    match m {
        ExcerptMedia::Images(bs) => {
            embed(json!({ "content": bs.iter().map(|b| image_part(b)).collect::<Vec<_>>() }))
        }
        ExcerptMedia::Audio(wav) => embed(
            json!({ "content": [{ "type": "input_audio", "input_audio": { "data": STANDARD.encode(wav), "format": "wav" } }] }),
        ),
        ExcerptMedia::Text(s) => text("classification", s),
    }
}
