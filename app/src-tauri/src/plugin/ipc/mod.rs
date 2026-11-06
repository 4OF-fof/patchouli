pub mod call;
pub mod manage;
pub mod menu;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Manager, State};

use crate::ai::embed;
use crate::library::StoredItem;
use crate::plugin::record::{self};
use crate::plugin::{self, Env, ItemInfo, Registry, Runner, UiRef};
use crate::session::{Current, cache_dir, with_session};
use crate::shell::{settings, tidy};

/// プラグインの置き場。同期するライブラリには入れず、アプリのデータフォルダにライブラリごとに置く。
/// 開発中は、どのライブラリも同じところを使う。
pub(crate) fn plugin_dir(app: &tauri::AppHandle, root: &Path) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let _ = (app, root);
        Ok(crate::session::dev_path(
            "PATCHOULI_PLUGIN_DIR",
            "dev-plugins",
        ))
    }
    #[cfg(not(debug_assertions))]
    Ok(plugins_home(app)?.join(format!(
        "{:016x}",
        crate::thumb::fnv(&[root.as_os_str().as_encoded_bytes()])
    )))
}

#[cfg(not(debug_assertions))]
fn plugins_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins"))
}

/// ライブラリごとの置き場に置く、どのライブラリのものかの印。
#[cfg(not(debug_assertions))]
const OWNER: &str = ".library";

/// 置き場を作り、どのライブラリのものかを書いておく。
pub(crate) fn make_plugin_dir(app: &tauri::AppHandle, root: &Path) -> Result<PathBuf, String> {
    let dir = plugin_dir(app, root)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    #[cfg(not(debug_assertions))]
    {
        let owner = dir.join(OWNER);
        if !owner.is_file() {
            std::fs::write(&owner, root.to_string_lossy().as_bytes())
                .map_err(|e| format!("{}: {e}", owner.display()))?;
        }
    }
    Ok(dir)
}

pub(crate) fn dev_unpack_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(cache_dir(app).ok()?.join("dev-plugins"))
}

pub(crate) fn dev_places(app: &tauri::AppHandle) -> Option<plugin::Dev> {
    let d = settings::developer(app)
        .inspect_err(|e| log::warn!("開発者モードの設定を読めない: {e}"))
        .ok()
        .filter(|d| d.enabled)?;
    Some(plugin::Dev {
        dirs: d.plugin_dirs,
        repos: d.repos,
        unpack: dev_unpack_dir(app)?,
    })
}

pub(crate) fn plugin_ids(root: &Path) -> Option<Vec<String>> {
    if !root.is_dir() {
        return None;
    }
    let r = record::Record::read(&record::path(root)).ok()?;
    Some(r.plugins.into_keys().collect())
}

pub(crate) struct Target {
    pub(crate) id: String,
    pub(crate) path: PathBuf,
    pub(crate) ext: String,
    pub(crate) note: bool,
    pub(crate) runner: Arc<Mutex<Runner>>,
    pub(crate) plugins: Arc<Registry>,
    pub(crate) thumbs: PathBuf,
}

impl Target {
    pub(crate) fn of(cur: &State<Current>, id: &str) -> Result<Target, String> {
        with_session(cur, |s| s.lib.asset(id).map(|_| ()))?;
        Target::any(cur, id)
    }

    /// ノートも受け取る。右クリックメニューに使う。
    pub(crate) fn any(cur: &State<Current>, id: &str) -> Result<Target, String> {
        with_session(cur, |s| {
            let (path, ext, note) = s.lib.file(id)?;
            Ok(Target {
                id: id.to_owned(),
                path: path.to_owned(),
                ext,
                note,
                runner: Arc::clone(&s.runner),
                plugins: Arc::clone(&s.plugins),
                thumbs: s.thumbs.clone(),
            })
        })
    }

    /// プラグインを呼ぶ。ほかの呼び出しが使っているあいだは待たず、新しく作って使う。
    pub(crate) fn run<T>(&self, f: impl FnOnce(&mut Runner, &str, &Path) -> T) -> T {
        self.runner(|r| f(r, &self.ext, &self.path))
    }

    pub(crate) fn runner<T>(&self, f: impl FnOnce(&mut Runner) -> T) -> T {
        match self.runner.try_lock() {
            Ok(mut r) => f(&mut r),
            Err(_) => f(&mut Runner::new(Arc::clone(&self.plugins))),
        }
    }

    pub(crate) fn item(&self) -> ScriptItem {
        ScriptItem {
            id: self.id.clone(),
            name: self
                .path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            ext: self.ext.clone(),
            file: self.path.clone(),
        }
    }
}

/// スクリプトに渡す素材。
#[derive(Serialize)]
pub(crate) struct ScriptItem {
    id: String,
    name: String,
    ext: String,
    file: PathBuf,
}

/// スクリプトが受け持つときに、画面に呼んでもらう先。
#[derive(Serialize)]
pub(crate) struct ScriptCall {
    #[serde(flatten)]
    ui: UiRef,
    items: Vec<ScriptItem>,
}

pub(crate) fn targets(cur: &State<Current>, ids: &[String]) -> Result<Vec<Target>, String> {
    ids.iter().map(|id| Target::any(cur, id)).collect()
}

pub(crate) fn info_of(it: StoredItem) -> ItemInfo {
    ItemInfo {
        id: it.id,
        name: it.name,
        note: it.note,
        project: it.project,
        tags: it.tags,
        memo: it.memo,
    }
}

/// library・embed がライブラリを引く窓口。
pub(crate) fn env_of(app: &tauri::AppHandle, thumbs: &Path) -> Arc<Env> {
    let a = app.clone();
    Arc::new(Env {
        ai: embed::installed() && settings::auto_tag(app).unwrap_or(false),
        thumbs: thumbs.to_owned(),
        info: Arc::new(move |id| {
            with_session(&a.state::<Current>(), |s| s.lib.stored(id))
                .ok()
                .flatten()
                .map(info_of)
        }),
    })
}

/// プラグインの置き場と、そこを使うライブラリ。最近開いたものにないライブラリは、使っていないことにする。
pub(crate) fn plugin_places(
    app: &tauri::AppHandle,
    current: Option<&Path>,
    recent: &[settings::Recent],
) -> Result<Vec<(PathBuf, Vec<PathBuf>)>, String> {
    #[cfg(debug_assertions)]
    {
        let mut users: Vec<PathBuf> = current.map(Path::to_owned).into_iter().collect();
        users.extend(recent.iter().map(|r| r.path.clone()));
        Ok(vec![(plugin_dir(app, Path::new(""))?, users)])
    }
    #[cfg(not(debug_assertions))]
    {
        let Ok(rd) = std::fs::read_dir(plugins_home(app)?) else {
            return Ok(Vec::new());
        };
        Ok(rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .map(|dir| {
                let owner = std::fs::read_to_string(dir.join(OWNER))
                    .ok()
                    .map(PathBuf::from)
                    .filter(|o| {
                        current == Some(o.as_path()) || recent.iter().any(|r| &r.path == o)
                    });
                (dir, owner.into_iter().collect())
            })
            .collect())
    }
}

pub(crate) fn remove_plugins(plugins: Vec<(tidy::Unused, PathBuf)>) -> Result<(), String> {
    for (u, path) in plugins {
        std::fs::remove_dir_all(&path).map_err(|e| format!("{}: {e}", u.name))?;
        // ライブラリの置き場が印だけになったら、置き場ごと消す
        #[cfg(not(debug_assertions))]
        if let Some(dir) = path.parent()
            && std::fs::read_dir(dir).is_ok_and(|rd| rd.flatten().all(|e| e.file_name() == OWNER))
        {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok(())
}
