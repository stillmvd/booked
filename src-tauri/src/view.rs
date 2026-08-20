use tauri::State;
use trove_core::view::{self, ViewState};

use crate::db::{with_conn, Db};

#[tauri::command]
pub fn view_state(db: State<Db>, folder_id: Option<i64>) -> Result<ViewState, String> {
    with_conn(&db, |conn| view::state(conn, folder_id))
}
