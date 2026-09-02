use crate::quickadd;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, Window, WindowEvent};

const OPEN_ID: &str = "open";
const CLIPBOARD_ID: &str = "clipboard";
const QUIT_ID: &str = "quit";

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN_ID, "Открыть Trove", true, None::<&str>)?;
    let clipboard = MenuItem::with_id(app, CLIPBOARD_ID, "Добавить из буфера", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &clipboard, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id == OPEN_ID {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            } else if event.id == CLIPBOARD_ID {
                quickadd::show_quick_add(app);
            } else if event.id == QUIT_ID {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}
