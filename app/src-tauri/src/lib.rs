mod ai;
mod background;
mod framed;
pub mod library;
pub mod plugin;
mod remote;
mod session;
mod shell;
pub mod thumb;

use tauri::Manager;

use ai::embed;
use plugin::ipc::manage::Staging;
use session::Current;
use shell::{ghost, settings, tray, web};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let commands: Box<dyn Fn(tauri::ipc::Invoke) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            library::ipc::open_library,
            library::ipc::choose_library,
            library::ipc::inspect_drop,
            library::ipc::import_files,
            library::ipc::save_item,
            library::ipc::move_item,
            library::ipc::save_state,
            library::ipc::tag_history,
            library::ipc::save_tag_history,
            library::ipc::open_history,
            library::ipc::save_open_history,
            library::ipc::tabs,
            library::ipc::save_tabs,
            library::ipc::create_note,
            library::ipc::create_project,
            library::ipc::save_project,
            library::ipc::save_tag_cover,
            library::ipc::rename_tag,
            library::ipc::delete_tag_cover,
            library::ipc::rename_project,
            library::ipc::delete_project,
            library::ipc::relink_meta,
            library::ipc::discard_meta,
            plugin::ipc::manage::plugins,
            plugin::ipc::manage::prepare_plugin,
            plugin::ipc::manage::prepare_update,
            plugin::ipc::manage::commit_plugin,
            plugin::ipc::manage::cancel_plugin,
            plugin::ipc::manage::plugin_latest,
            plugin::ipc::manage::set_plugin_prerelease,
            plugin::ipc::manage::remove_plugin,
            plugin::ipc::manage::pick_plugin,
            plugin::ipc::manage::set_plugin_enabled,
            shell::ipc::developer,
            shell::ipc::set_developer,
            shell::ipc::app_settings,
            shell::ipc::set_app_settings,
            shell::ipc::pick_command,
            shell::ipc::pick_dev_path,
            plugin::ipc::manage::reload_plugins,
            plugin::ipc::manage::plugin_work,
            plugin::ipc::manage::stop_plugin_work,
            thumb::ipc::seen_thumbs,
            plugin::ipc::manage::hook_work,
            plugin::ipc::manage::stop_hooks,
            plugin::ipc::menu::export_data,
            library::ipc::checking,
            plugin::ipc::manage::set_plugin_setting,
            plugin::ipc::call::item_view,
            plugin::ipc::call::item_details,
            library::ipc::rename_item,
            library::ipc::note_left,
            plugin::ipc::call::item_decoded,
            shell::ipc::reveal_item,
            shell::ipc::open_item_default,
            shell::ipc::item_path,
            plugin::ipc::menu::item_menu,
            plugin::ipc::menu::run_item_menu,
            thumb::ipc::wasm_thumbnail,
            plugin::ipc::call::wasm_details,
            ai::ipc::content_wasm,
            ai::ipc::put_content,
            library::ipc::delete_item,
            plugin::ipc::call::plugin_read,
            plugin::ipc::call::plugin_call,
            plugin::ipc::call::render_code,
            plugin::ipc::call::plugin_settings,
            plugin::ipc::call::plugin_data,
            plugin::ipc::call::set_plugin_data,
            thumb::ipc::put_thumbnail,
            thumb::ipc::pick_custom_thumb,
            thumb::ipc::paste_custom_thumb,
            thumb::ipc::clear_custom_thumb,
            library::ipc::import_data,
            thumb::ipc::missing_waveforms,
            thumb::ipc::put_waveform,
            thumb::ipc::waveform,
            library::ipc::libraries,
            library::ipc::switch_library,
            library::ipc::forget_library,
            ai::ipc::auto_tag,
            ai::ipc::set_auto_tag,
            ai::ipc::cancel_auto_tag_download,
            ai::ipc::set_tag_suggest,
            ai::ipc::set_content_search,
            ai::ipc::prepare_content_search,
            ai::ipc::search_content,
            ai::ipc::record_tags,
            ai::ipc::undo_tags,
            ai::ipc::suggest_tags,
            shell::ipc::cache_usage,
            shell::ipc::clear_cache,
            shell::ipc::unused_plugins,
            shell::ipc::remove_unused_plugins,
            shell::ipc::open_url,
            plugin::ipc::call::plugin_fetch,
            shell::ipc::browser_show,
            shell::ipc::browser_go,
            shell::ipc::browser_layer,
            shell::ipc::browser_hide,
            shell::ipc::browser_close,
            shell::ipc::browser_close_all,
            shell::ipc::ghost_show,
            shell::ipc::ghost_move,
            shell::ipc::ghost_hide,
            tray::close_to_tray,
            tray::quit_app,
            tray::show_app,
            remote::ipc::remote_status,
            remote::ipc::set_remote_path,
            remote::ipc::install_skill,
            remote::ipc::remove_skill,
            remote::ipc::pick_skill_dir,
            remote::ipc::add_extension,
            remote::ipc::remove_extension,
            remote::ipc::set_remote_client,
            remote::ipc::forget_remote_client,
            remote::ipc::remote_asks,
            remote::ipc::answer_remote,
            remote::ipc::retry_toast,
            shell::toast::expect_toast,
            shell::toast::place_toast
        ]);
    // 二重に起動したときは、動いているほうのウィンドウを出して終える
    if remote::server::running(!tray::background()) {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Current::default())
        .manage(Staging::default())
        .manage(web::Pages::default())
        .register_uri_scheme_protocol("plugin", |ctx, req| {
            if !web::ours(ctx.webview_label()) {
                return plugin::files::serve("", None);
            }
            plugin::ipc::call::plugin_file(ctx.app_handle(), &req)
        })
        .invoke_handler(move |invoke| {
            if invoke.message.webview_ref().label() != web::MAIN {
                invoke.resolver.reject("外のページからは使えません");
                return true;
            }
            commands(invoke)
        })
        .on_window_event(|w, e| {
            // タブのウィンドウは本体の窓の JS が描くので、本体の窓と一緒に閉じる
            if w.label() == web::MAIN && matches!(e, tauri::WindowEvent::Destroyed) {
                web::close_popouts(w.app_handle());
                ghost::close(w.app_handle());
            }
        })
        .setup(|app| {
            // タブを別のウィンドウに出すときの window.open を受けるため、本体の窓は設定から自分で作る
            let conf = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == web::MAIN)
                .ok_or("本体のウィンドウの設定がありません")?
                .clone();
            let handle = app.handle().clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &conf)?
                .visible(!tray::background())
                .on_new_window(move |url, features| web::popout(&handle, url, features))
                .build()?;
            tray::init(app.handle())?;
            remote::server::start(app.handle());
            {
                let app = app.handle().clone();
                std::thread::spawn(move || remote::setup::refresh(&app));
            }
            // 前に起動したときに広げた開発版は、もう使っていない
            if let Some(d) = plugin::ipc::dev_unpack_dir(app.handle()) {
                let _ = std::fs::remove_dir_all(d);
            }
            if let Ok(d) = session::cache_dir(app.handle()) {
                plugin::set_compiled_dir(d.join("wasm"));
            }
            if let Ok(d) = app.path().app_data_dir() {
                embed::init(&d);
            }
            if let Ok(s) = settings::app_settings(app.handle()) {
                shell::ipc::apply_app_settings(&s);
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, e| match e {
            tauri::RunEvent::Exit => embed::shutdown(),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => tray::show_main(_app),
            _ => {}
        });
}
