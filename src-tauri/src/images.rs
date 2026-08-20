use std::path::Path;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn image_import(app: AppHandle, source: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    trove_core::images::import(&dir, Path::new(&source)).map_err(|e| e.to_string())
}
