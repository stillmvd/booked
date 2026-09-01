use tauri::State;

use crate::db::{with_conn_mut, Db};

#[tauri::command]
pub fn items_reorder(
    db: State<Db>,
    folder_id: Option<i64>,
    folder_ids: Vec<i64>,
    bookmark_ids: Vec<i64>,
) -> Result<(), String> {
    with_conn_mut(&db, |conn| {
        trove_core::ordering::reorder(conn, folder_id, &folder_ids, &bookmark_ids)
    })
}
