mod bookmarks;
mod browsers;
mod db;
mod folders;
mod images;
mod net;
mod preview;
#[cfg(desktop)]
mod quickadd;
mod search;
mod tags;
mod view;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(quickadd::global_shortcut_plugin());

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            let path = handle
                .path()
                .app_local_data_dir()
                .ok()
                .map(|dir| dir.join("trove.db").display().to_string())
                .unwrap_or_default();
            let result = db::open(&handle).map_err(|e| trove_core::db::DbFailure {
                path,
                message: e.to_string(),
            });
            app.manage(db::Db(Mutex::new(result)));
            app.manage(net::Fetcher::new(net::build_client()));
            #[cfg(desktop)]
            quickadd::setup(&handle)?;
            if let Some(main) = handle.get_webview_window("main") {
                let exit_handle = handle.clone();
                main.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        exit_handle.exit(0);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            folders::folder_create,
            folders::folder_children,
            folders::folder_breadcrumbs,
            folders::folder_move,
            folders::folder_update,
            folders::folder_list_all,
            folders::folder_contents_count,
            folders::folder_delete,
            tags::tag_list,
            tags::tag_counts,
            images::image_import,
            bookmarks::bookmark_create,
            bookmarks::bookmark_update,
            bookmarks::bookmark_open,
            bookmarks::bookmark_find_duplicate,
            bookmarks::bookmark_set_tags,
            bookmarks::bookmark_delete,
            browsers::browser_list,
            browsers::bookmark_set_browser,
            browsers::bookmark_open_with,
            preview::preview_fetch,
            preview::preview_refresh,
            preview::meta_fetch,
            preview::preview_clear_user_image,
            preview::preview_backfill,
            preview::preview_backfill_cancel,
            search::search_query,
            db::db_status,
            db::db_reveal,
            db::db_start_fresh,
            view::view_state,
            view::view_set_band_collapsed,
            view::view_set_mode,
            view::view_reset_overrides,
            #[cfg(desktop)]
            quickadd::clipboard_url,
            #[cfg(desktop)]
            quickadd::hotkey_status,
            #[cfg(desktop)]
            quickadd::quick_add_set_dirty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
