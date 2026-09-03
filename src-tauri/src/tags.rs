use tauri::State;
use booked_core::tags::{counts, list_all, TagCount};

use crate::db::{with_conn, Db};

#[tauri::command]
pub fn tag_list(db: State<Db>) -> Result<Vec<String>, String> {
    with_conn(&db, list_all)
}

#[tauri::command]
pub fn tag_counts(db: State<Db>) -> Result<Vec<TagCount>, String> {
    with_conn(&db, counts)
}
