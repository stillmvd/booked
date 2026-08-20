use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use trove_core::db::DbFailure;

pub struct Db(pub Mutex<Result<Connection, DbFailure>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub fn open(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_local_data_dir()
        .expect("no local data dir");
    trove_core::db::open_at(&dir)
}

pub fn with_conn<T>(
    db: &State<Db>,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let guard = db.0.lock().map_err(|e| e.to_string())?;
    match &*guard {
        Ok(conn) => f(conn).map_err(|e| e.to_string()),
        Err(failure) => Err(failure.message.clone()),
    }
}

pub fn with_conn_mut<T>(
    db: &State<Db>,
    f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    match &mut *guard {
        Ok(conn) => f(conn).map_err(|e| e.to_string()),
        Err(failure) => Err(failure.message.clone()),
    }
}

#[tauri::command]
pub fn db_status(db: State<Db>) -> DbStatus {
    let guard = match db.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    match &*guard {
        Ok(_) => DbStatus { ok: true, path: None, message: None },
        Err(failure) => DbStatus {
            ok: false,
            path: Some(failure.path.clone()),
            message: Some(failure.message.clone()),
        },
    }
}

#[tauri::command]
pub fn db_reveal(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri_plugin_opener::reveal_item_in_dir(dir.join("trove.db")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_start_fresh(app: AppHandle, db: State<Db>) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    if guard.is_ok() {
        return Err("база данных уже открыта, начать заново нельзя".into());
    }
    let result = trove_core::db::start_fresh_at(&dir);
    let message = result.as_ref().err().map(|f| f.message.clone());
    *guard = result;
    match message {
        None => Ok(()),
        Some(message) => Err(message),
    }
}
