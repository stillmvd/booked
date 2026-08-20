mod bookmarks;
mod db;
mod folders;
mod images;
mod tags;
mod url_norm;

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
            let result = db::open(&handle).map_err(|e| db::DbFailure {
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
            tags::tag_list,
            images::image_import,
            bookmarks::bookmark_create,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
