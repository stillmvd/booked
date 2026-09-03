use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

pub fn launched_minimized() -> bool {
    magpie_core::autostart::is_minimized_arg(std::env::args())
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn autostart_supported() -> bool {
    false
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn autostart_supported() -> bool {
    true
}

#[tauri::command]
pub fn autostart_get<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_set<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if enabled { manager.enable() } else { manager.disable() };
    result.map_err(|e| e.to_string())
}
