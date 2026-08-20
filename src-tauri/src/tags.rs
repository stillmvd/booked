use tauri::State;
use trove_core::tags::list_all;

use crate::db::{with_conn, Db};

#[tauri::command]
pub fn tag_list(db: State<Db>) -> Result<Vec<String>, String> {
    with_conn(&db, list_all)
}
