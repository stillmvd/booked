use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use trove_core::{settings, url_norm};

use crate::db::{with_conn, Db};

pub const QUICK_ADD_LABEL: &str = "quick-add";
pub const QUICK_ADD_SHOW_EVENT: &str = "quick-add:show";
const DEFAULT_COMBO: &str = "Ctrl+Alt+B";

pub struct QuickAdd {
    dirty: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub registered: bool,
    pub combo: String,
}

pub struct HotkeyState(Mutex<HotkeyStatus>);

impl HotkeyState {
    fn snapshot(&self) -> HotkeyStatus {
        match self.0.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn set(&self, status: HotkeyStatus) {
        match self.0.lock() {
            Ok(mut guard) => *guard = status,
            Err(poisoned) => *poisoned.into_inner() = status,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardUrl {
    pub url: Option<String>,
    pub has_text: bool,
}

fn parse_hotkey(combo: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(combo).map_err(|_| "Не получилось разобрать комбинацию.".to_string())
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
pub fn hotkey_status(state: State<HotkeyState>) -> HotkeyStatus {
    state.snapshot()
}

#[tauri::command]
pub fn hotkey_set(
    app: AppHandle,
    db: State<Db>,
    state: State<HotkeyState>,
    combo: String,
) -> Result<HotkeyStatus, String> {
    let current = state.snapshot();
    if current.combo == combo {
        return Ok(current);
    }

    let new_shortcut = parse_hotkey(&combo)?;

    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|_| "Эту комбинацию занимает другая программа. Выберите другую.".to_string())?;

    if let Ok(old_shortcut) = parse_hotkey(&current.combo) {
        let _ = app.global_shortcut().unregister(old_shortcut);
    }

    let updated = HotkeyStatus { registered: true, combo: combo.clone() };
    state.set(updated.clone());

    let _ = with_conn(&db, |conn| settings::write(conn, "quick_add_hotkey", &combo));

    Ok(updated)
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
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let combo = app.state::<HotkeyState>().snapshot().combo;
            let Ok(live) = parse_hotkey(&combo) else { return };
            if shortcut != &live {
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

    let stored_combo = with_conn(&app.state::<Db>(), settings::read).ok().map(|s| s.quick_add_hotkey);
    let combo = stored_combo
        .filter(|c| parse_hotkey(c).is_ok())
        .unwrap_or_else(|| DEFAULT_COMBO.to_string());
    let shortcut = parse_hotkey(&combo).expect("default hotkey combo must parse");
    let registered = app.global_shortcut().register(shortcut).is_ok();
    app.manage(HotkeyState(Mutex::new(HotkeyStatus { registered, combo })));

    Ok(())
}
