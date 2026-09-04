use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct PendingUpdate {
    update: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

fn pending(app: &AppHandle) -> tauri::State<'_, PendingUpdate> {
    app.state::<PendingUpdate>()
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder();
    #[cfg(debug_assertions)]
    {
        if let Ok(endpoint) = std::env::var("BOOKED_UPDATE_ENDPOINT") {
            let url = endpoint.parse().map_err(|e: url::ParseError| e.to_string())?;
            builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
        }
        if std::env::var_os("BOOKED_UPDATE_FORCE").is_some() {
            builder = builder.version_comparator(|_, _| true);
        }
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        body: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    let state = pending(&app);
    *state.update.lock().map_err(|e| e.to_string())? = update;
    *state.bytes.lock().map_err(|e| e.to_string())? = None;
    Ok(info)
}

#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<u64, String> {
    let update = pending(&app)
        .update
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "сначала нужно проверить обновления".to_string())?;
    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", UpdateProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;
    *pending(&app).bytes.lock().map_err(|e| e.to_string())? = Some(bytes);
    Ok(size)
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let state = pending(&app);
    let update = state
        .update
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "сначала нужно проверить обновления".to_string())?;
    let bytes = state
        .bytes
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "обновление ещё не скачано".to_string())?;
    #[cfg(debug_assertions)]
    if std::env::var_os("BOOKED_UPDATE_NO_INSTALL").is_some() {
        return Ok(());
    }
    update.install(bytes).map_err(|e| e.to_string())
}
