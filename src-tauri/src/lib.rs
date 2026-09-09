#[cfg(desktop)]
mod autostart;
mod backup;
mod bookmarks;
mod browsers;
mod db;
mod folders;
mod games;
mod images;
mod liveness;
mod net;
mod ordering;
mod preview;
#[cfg(desktop)]
mod quickadd;
mod search;
mod settings;
mod tags;
#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod updates;
mod view;
#[cfg(desktop)]
mod window;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        tray::show_main(app);
    }));

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(quickadd::global_shortcut_plugin())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .with_denylist(&["quick-add"])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(updates::PendingUpdate::default())
        .on_window_event(tray::on_window_event);

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            let path = handle
                .path()
                .app_local_data_dir()
                .ok()
                .map(|dir| dir.join("booked.db").display().to_string())
                .unwrap_or_default();
            let result = db::open(&handle).map_err(|e| booked_core::db::DbFailure {
                path,
                message: e.to_string(),
            });
            app.manage(db::Db(Mutex::new(result)));
            app.manage(net::Fetcher::new(net::build_client()));
            games::setup(&handle);
            #[cfg(desktop)]
            quickadd::setup(&handle)?;
            #[cfg(desktop)]
            tray::setup(&handle)?;
            #[cfg(desktop)]
            if !autostart::launched_minimized() {
                tray::show_main(&handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            games::games_library,
            games::games_rescan,
            games::games_root_set,
            games::games_measure,
            games::game_set_title,
            games::game_set_version,
            games::game_set_status,
            games::game_set_rating,
            games::game_set_tags,
            games::game_set_image,
            games::game_set_cover_pos,
            games::game_forget,
            games::game_exe_list,
            games::game_set_exe,
            games::game_launch,
            games::game_delete_folder,
            games::game_set_page,
            games::game_skip_version,
            games::game_refresh_cover,
            games::game_open_page,
            games::games_check,
            folders::folder_create,
            folders::folder_children,
            folders::folder_breadcrumbs,
            folders::folder_move,
            folders::folder_update,
            folders::folder_list_all,
            folders::folder_tree,
            folders::folder_contents_count,
            folders::folder_delete,
            tags::tag_list,
            tags::tag_counts,
            images::image_import,
            images::image_import_bytes,
            images::image_import_url,
            bookmarks::bookmark_create,
            bookmarks::bookmark_update,
            bookmarks::bookmark_open,
            bookmarks::bookmark_find_duplicate,
            bookmarks::bookmark_set_tags,
            bookmarks::bookmark_delete,
            browsers::browser_list,
            browsers::browser_default_get,
            browsers::browser_default_set,
            browsers::bookmark_set_browser,
            browsers::bookmark_open_with,
            browsers::folder_set_browser,
            browsers::folder_inherited_browser,
            preview::preview_fetch,
            preview::preview_refresh,
            preview::meta_fetch,
            preview::preview_clear_user_image,
            preview::preview_backfill,
            preview::preview_backfill_cancel,
            liveness::liveness_sweep,
            liveness::liveness_check,
            search::search_query,
            settings::settings_read,
            settings::settings_write,
            backup::backup_export,
            backup::backup_inspect,
            backup::backup_import,
            db::db_status,
            db::db_reveal,
            db::db_start_fresh,
            view::view_state,
            view::view_set_band_collapsed,
            view::view_set_mode,
            view::view_reset_overrides,
            view::view_set_sort,
            ordering::items_reorder,
            #[cfg(desktop)]
            quickadd::clipboard_url,
            #[cfg(desktop)]
            quickadd::hotkey_status,
            #[cfg(desktop)]
            quickadd::hotkey_set,
            #[cfg(desktop)]
            quickadd::quick_add_set_dirty,
            #[cfg(desktop)]
            tray::hide_to_tray,
            #[cfg(desktop)]
            tray::close_to_tray,
            #[cfg(desktop)]
            tray::app_quit,
            #[cfg(desktop)]
            autostart::autostart_supported,
            #[cfg(desktop)]
            autostart::autostart_get,
            #[cfg(desktop)]
            autostart::autostart_set,
            #[cfg(desktop)]
            window::window_glass_apply,
            #[cfg(desktop)]
            window::window_glass_clear,
            #[cfg(desktop)]
            updates::update_check,
            #[cfg(desktop)]
            updates::update_download,
            #[cfg(desktop)]
            updates::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
