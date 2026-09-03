use crate::db::{with_conn, Db};
use crate::quickadd;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
use booked_core::settings::{self, CloseAction};

const MAIN_LABEL: &str = "main";

const OPEN_ID: &str = "open";
const CLIPBOARD_ID: &str = "clipboard";
const QUIT_ID: &str = "quit";

pub const CLOSE_ASK_EVENT: &str = "window:close-ask";
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray.png");
const TRAY_NOTICE_BODY: &str = "Booked работает в трее";

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN_ID, "Открыть Booked", true, None::<&str>)?;
    let clipboard = MenuItem::with_id(app, CLIPBOARD_ID, "Добавить из буфера", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &clipboard, &quit])?;

    let tray_image = Image::from_bytes(TRAY_ICON_PNG)
        .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
    let icon = TrayIconBuilder::new()
        .icon(tray_image)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id == OPEN_ID {
                show_main(app);
            } else if event.id == CLIPBOARD_ID {
                quickadd::show_quick_add(app);
            } else if event.id == QUIT_ID {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(icon);

    Ok(())
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != MAIN_LABEL {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        handle_close_request(&window.app_handle());
    }
}

fn read_close_action<R: Runtime>(app: &AppHandle<R>) -> CloseAction {
    let db = app.state::<Db>();
    with_conn(&db, settings::read)
        .map(|s| s.close_action)
        .unwrap_or(CloseAction::Ask)
}

fn handle_close_request<R: Runtime>(app: &AppHandle<R>) {
    match read_close_action(app) {
        CloseAction::Ask => {
            if let Some(window) = app.get_webview_window(MAIN_LABEL) {
                let _ = window.emit(CLOSE_ASK_EVENT, ());
            }
        }
        CloseAction::Tray => hide_to_tray_and_notify(app),
        CloseAction::Quit => app.exit(0),
    }
}

fn hide_to_tray_and_notify<R: Runtime>(app: &AppHandle<R>) {
    hide_to_tray_inner(app);
    notify_tray_once(app);
}

fn notify_tray_once<R: Runtime>(app: &AppHandle<R>) {
    let db = app.state::<Db>();
    let already_shown = with_conn(&db, settings::read)
        .map(|s| s.tray_notice_shown)
        .unwrap_or(true);
    if already_shown {
        return;
    }
    let _ = app.notification().builder().title("Booked").body(TRAY_NOTICE_BODY).show();
    let _ = with_conn(&db, |conn| settings::write(conn, "tray_notice_shown", "1"));
}

pub(crate) fn show_main<R: Runtime>(app: &AppHandle<R>) {
    ensure_main_window(app);
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_to_tray_inner<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
    }
}

pub fn ensure_main_window<R: Runtime>(app: &AppHandle<R>) {
    if app.get_webview_window(MAIN_LABEL).is_some() {
        return;
    }
    if let Ok(window) = WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title("Booked")
        .inner_size(1100.0, 720.0)
        .center()
        .decorations(false)
        .transparent(true)
        .drag_and_drop(false)
        .build()
    {
        let _ = window.minimize();
    }
}

#[tauri::command]
pub fn hide_to_tray(app: AppHandle) {
    handle_close_request(&app);
}

#[tauri::command]
pub fn close_to_tray(app: AppHandle) {
    hide_to_tray_and_notify(&app);
}

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_icon_png_decodes_to_32px_square() {
        let image = Image::from_bytes(TRAY_ICON_PNG).expect("tray.png decodes");
        assert_eq!((image.width(), image.height()), (32, 32));
    }
}
