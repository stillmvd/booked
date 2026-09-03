use tauri::State;
use magpie_core::settings::{self, Settings};

use crate::db::{with_conn, Db};

#[tauri::command]
pub fn settings_read(db: State<Db>) -> Result<Settings, String> {
    with_conn(&db, settings::read)
}

#[tauri::command]
pub fn settings_write(db: State<Db>, key: String, value: String) -> Result<(), String> {
    with_conn(&db, |conn| settings::write(conn, &key, &value))
}
