use crate::net::{fetch_image, Fetcher};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn image_import(app: AppHandle, source: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    booked_core::images::import(&dir, Path::new(&source)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn image_import_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("ожидались байты картинки".into());
    };
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    booked_core::images::import_bytes(&dir, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn image_import_url(
    app: AppHandle,
    fetcher: State<'_, Fetcher>,
    url: String,
) -> Result<String, String> {
    let image = fetch_image(&fetcher, &url).await.map_err(|e| e.to_string())?;
    if !image.status_ok {
        return Err("картинку по этой ссылке скачать не вышло".into());
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    booked_core::images::import_bytes(&dir, &image.bytes).map_err(|e| e.to_string())
}
