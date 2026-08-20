mod bookmarks;
mod db;
mod folders;
mod images;
mod tags;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            images::image_import,
            bookmarks::bookmark_create,
            bookmarks::bookmark_update,
            bookmarks::bookmark_open,
            bookmarks::bookmark_find_duplicate,
            bookmarks::bookmark_set_tags,
            bookmarks::bookmark_delete,
            db::db_status,
            db::db_reveal,
            db::db_start_fresh,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
