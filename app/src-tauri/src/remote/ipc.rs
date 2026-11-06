use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::remote::clients::{self, Ask};
use crate::remote::proto::HOST;
use crate::remote::setup;
use crate::shell::settings::{self, RemoteClient};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillPlace {
    dir: PathBuf,
    installed: bool,
    /// 候補として出す場所か。ほかは利用者が選択したフォルダ
    suggested: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteStatus {
    /// アプリと一緒に入れた CLI。見つからなければ None
    cli: Option<PathBuf>,
    /// PATH に置くコマンド
    command: PathBuf,
    path: bool,
    host: &'static str,
    skills: Vec<SkillPlace>,
    extensions: Vec<String>,
    clients: Vec<RemoteClient>,
}

#[tauri::command]
pub(crate) async fn remote_status(app: AppHandle) -> Result<RemoteStatus, String> {
    let r = settings::remote(&app)?;
    let suggested = setup::skill_candidates(&app)?;
    let mut skills: Vec<SkillPlace> = suggested
        .iter()
        .map(|d| SkillPlace {
            installed: setup::skill_installed(d),
            dir: d.clone(),
            suggested: true,
        })
        .collect();
    for d in r.skills.iter().filter(|d| !suggested.contains(d)) {
        skills.push(SkillPlace {
            installed: setup::skill_installed(d),
            dir: d.clone(),
            suggested: false,
        });
    }
    let mut clients = r.clients;
    clients.sort_by(|a, b| b.last.total_cmp(&a.last));
    Ok(RemoteStatus {
        cli: setup::cli(),
        command: setup::command(&app)?,
        path: r.path,
        host: HOST,
        skills,
        extensions: r.extensions,
        clients,
    })
}

#[tauri::command]
pub(crate) async fn set_remote_path(app: AppHandle, on: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || setup::set_path(&app, on))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn install_skill(app: AppHandle, dir: PathBuf) -> Result<(), String> {
    setup::install_skill(&app, &dir)
}

#[tauri::command]
pub(crate) async fn remove_skill(app: AppHandle, dir: PathBuf) -> Result<(), String> {
    setup::remove_skill(&app, &dir)
}

#[tauri::command]
pub(crate) async fn pick_skill_dir(app: AppHandle) -> Result<Option<PathBuf>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("skill をインストールするフォルダを選択")
        .blocking_pick_folder();
    picked
        .map(|p| p.into_path().map_err(|e| e.to_string()))
        .transpose()
}

#[tauri::command]
pub(crate) async fn add_extension(app: AppHandle, id: String) -> Result<(), String> {
    let id = id.trim().to_owned();
    if !setup::valid_extension(&id) {
        return Err(format!("「{id}」は拡張機能の ID として使用できません"));
    }
    settings::update_remote(&app, |r| {
        if !r.extensions.contains(&id) {
            r.extensions.push(id.clone());
        }
        Ok(())
    })?;
    setup::write_hosts(&app)
}

#[tauri::command]
pub(crate) async fn remove_extension(app: AppHandle, id: String) -> Result<(), String> {
    settings::update_remote(&app, |r| {
        r.extensions.retain(|x| x != &id);
        r.clients.retain(|c| c.key != format!("extension:{id}"));
        Ok(())
    })?;
    setup::write_hosts(&app)
}

#[tauri::command]
pub(crate) async fn set_remote_client(
    app: AppHandle,
    key: String,
    allowed: bool,
    permissions: Vec<String>,
) -> Result<(), String> {
    settings::update_remote(&app, |r| {
        let c = r
            .clients
            .iter_mut()
            .find(|c| c.key == key)
            .ok_or_else(|| format!("接続先「{key}」が見つかりません"))?;
        c.allowed = allowed;
        c.permissions = clients::known_permissions(permissions);
        Ok(())
    })
}

#[tauri::command]
pub(crate) async fn forget_remote_client(app: AppHandle, key: String) -> Result<(), String> {
    settings::update_remote(&app, |r| {
        r.clients.retain(|c| c.key != key);
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn remote_asks() -> Vec<Ask> {
    clients::pending()
}

#[tauri::command]
pub(crate) fn answer_remote(id: u64, permissions: Option<Vec<String>>) {
    clients::answer(id, permissions);
}
