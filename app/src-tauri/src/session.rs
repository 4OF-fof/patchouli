use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{Manager, State};

use crate::library::Library;
use crate::plugin::{Reads, Registry, Runner};
use crate::shell::settings;

#[derive(Default)]
pub(crate) struct Current(pub(crate) Mutex<Option<Session>>);

impl Current {
    /// 持っていたスレッドが落ちても、ライブラリは開いたままにする。
    pub(crate) fn lock(&self) -> MutexGuard<'_, Option<Session>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) struct Session {
    /// 素材を読み直すたびに変わる。裏の突き合わせが、読み直す前の結果を持ち込まないようにする。
    pub(crate) id: u64,
    pub(crate) lib: Library,
    pub(crate) thumbs: PathBuf,
    pub(crate) plugins: Arc<Registry>,
    /// 詳細の表示に使う。プラグインが長く動いてもほかの操作を止めないよう、Session のロックを放してから使う。
    pub(crate) runner: Arc<Mutex<Runner>>,
    pub(crate) ui_reads: HashMap<String, Reads>,
    /// GitHub から入れたプラグインの、調べて分かった最新のリリースのタグ。
    pub(crate) latest: HashMap<String, String>,
}

#[cfg(debug_assertions)]
pub(crate) fn dev_path(var: &str, dir: &str) -> PathBuf {
    std::env::var_os(var).map_or_else(
        || {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../example")
                .join(dir)
        },
        PathBuf::from,
    )
}

pub(crate) fn next_session() -> u64 {
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

pub(crate) fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map_err(|e| e.to_string())
}

pub(crate) fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("PATCHOULI_LIBRARY") {
        return Ok(PathBuf::from(p));
    }
    if let Some(p) = settings::library(app)? {
        return Ok(p);
    }
    #[cfg(debug_assertions)]
    return Ok(dev_path("PATCHOULI_LIBRARY", "dev-library"));
    #[cfg(not(debug_assertions))]
    Err("ライブラリが選択されていません".into())
}

pub(crate) fn with<T>(
    cur: &State<Current>,
    f: impl FnOnce(&mut Library) -> Result<T, String>,
) -> Result<T, String> {
    with_session(cur, |s| f(&mut s.lib))
}

pub(crate) fn with_session<T>(
    cur: &State<Current>,
    f: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut g = cur.lock();
    let s = g.as_mut().ok_or("ライブラリが開かれていません")?;
    f(s)
}

pub(crate) fn root_of(cur: &State<Current>) -> Result<PathBuf, String> {
    with(cur, |l| Ok(l.root().to_owned()))
}
