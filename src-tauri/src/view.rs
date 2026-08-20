use tauri::State;
use trove_core::view::{self, ViewMode, ViewState};

use crate::db::{with_conn, Db};

#[tauri::command]
pub fn view_state(db: State<Db>, folder_id: Option<i64>) -> Result<ViewState, String> {
    with_conn(&db, |conn| view::state(conn, folder_id))
}

#[tauri::command]
pub fn view_set_band_collapsed(
    db: State<Db>,
    folder_id: Option<i64>,
    collapsed: bool,
) -> Result<(), String> {
    with_conn(&db, |conn| view::set_band_collapsed(conn, folder_id, collapsed))
}

#[tauri::command]
pub fn view_set_mode(db: State<Db>, folder_id: Option<i64>, mode: ViewMode) -> Result<(), String> {
    with_conn(&db, |conn| view::set_mode(conn, folder_id, mode))
}

#[tauri::command]
pub fn view_reset_overrides(db: State<Db>, mode: ViewMode) -> Result<(), String> {
    with_conn(&db, |conn| view::reset_overrides(conn, mode))
}
