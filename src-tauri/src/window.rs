use tauri::{Runtime, WebviewWindow};

const MAIN_LABEL: &str = "main";

pub fn apply_glass<R: Runtime>(window: &WebviewWindow<R>, dark: bool) -> bool {
    #[cfg(windows)]
    {
        static WARNED: std::sync::Once = std::sync::Once::new();
        match window_vibrancy::apply_mica(window, Some(dark)) {
            Ok(()) => true,
            Err(e) => {
                WARNED.call_once(|| eprintln!("Mica недоступен: {e}"));
                false
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (window, dark);
        false
    }
}

pub fn clear_glass<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    #[cfg(windows)]
    {
        window_vibrancy::clear_mica(window).is_ok()
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        false
    }
}

#[tauri::command]
pub fn window_glass_apply(window: WebviewWindow, dark: bool) -> bool {
    window.label() == MAIN_LABEL && apply_glass(&window, dark)
}

#[tauri::command]
pub fn window_glass_clear(window: WebviewWindow) -> bool {
    window.label() == MAIN_LABEL && clear_glass(&window)
}
