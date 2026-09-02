use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use trove_core::url_norm;

pub const QUICK_ADD_LABEL: &str = "quick-add";
pub const QUICK_ADD_SHOW_EVENT: &str = "quick-add:show";
const HOTKEY_COMBO: &str = "Ctrl+Alt+B";

pub struct QuickAdd {
    dirty: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub registered: bool,
    pub combo: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardUrl {
    pub url: Option<String>,
    pub has_text: bool,
}

fn hotkey() -> Shortcut {
    Shortcut::from_str(HOTKEY_COMBO).expect("valid hotkey combo")
}

#[tauri::command]
pub fn clipboard_url(app: AppHandle) -> ClipboardUrl {
    let text = app.clipboard().read_text().unwrap_or_default();
    if text.trim().is_empty() {
        return ClipboardUrl { url: None, has_text: false };
    }
    match url_norm::parse(&text) {
        Ok(parsed) => ClipboardUrl { url: Some(parsed.url), has_text: true },
        Err(_) => ClipboardUrl { url: None, has_text: true },
    }
}

#[tauri::command]
pub fn hotkey_status(status: State<HotkeyStatus>) -> HotkeyStatus {
    status.inner().clone()
}

#[tauri::command]
pub fn quick_add_set_dirty(state: State<QuickAdd>, dirty: bool) {
    state.dirty.store(dirty, Ordering::Relaxed);
}

pub fn show_quick_add<R: tauri::Runtime>(app: &AppHandle<R>) {
    crate::tray::ensure_main_window(app);
    if let Some(window) = app.get_webview_window(QUICK_ADD_LABEL) {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit(QUICK_ADD_SHOW_EVENT, ());
    }
}

pub fn global_shortcut_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if shortcut != &hotkey() || event.state() != ShortcutState::Pressed {
                return;
            }
            show_quick_add(app);
        })
        .build()
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(QuickAdd { dirty: AtomicBool::new(false) });

    let window = WebviewWindowBuilder::new(app, QUICK_ADD_LABEL, WebviewUrl::App("index.html".into()))
        .title("Trove")
        .visible(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .center()
        .inner_size(520.0, 360.0)
        .build()?;

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            let dirty = app_handle.state::<QuickAdd>().dirty.load(Ordering::Relaxed);
            if !dirty {
                if let Some(win) = app_handle.get_webview_window(QUICK_ADD_LABEL) {
                    let _ = win.hide();
                }
            }
        }
    });

    let registered = app.global_shortcut().register(hotkey()).is_ok();
    app.manage(HotkeyStatus { registered, combo: HOTKEY_COMBO.to_string() });

    Ok(())
}
