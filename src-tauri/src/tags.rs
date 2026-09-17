use rusqlite::Connection;
use tauri::{AppHandle, Emitter, State};
use booked_core::tags::{self, counts, list_all, RenameOutcome, TagCount, TagError, TagTarget, TagUsage};

use crate::db::{with_conn, with_conn_mut, Db};
use crate::games::GAMES_CHANGED_EVENT;

fn run<T>(db: &Db, f: impl FnOnce(&mut Connection) -> Result<T, TagError>) -> Result<T, String> {
    with_conn_mut(db, |conn| Ok(f(conn)))?.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tag_list(db: State<Db>) -> Result<Vec<String>, String> {
    with_conn(&db, list_all)
}

#[tauri::command]
pub fn tag_counts(db: State<Db>) -> Result<Vec<TagCount>, String> {
    with_conn(&db, counts)
}

#[tauri::command]
pub fn tag_usage(db: State<Db>) -> Result<Vec<TagUsage>, String> {
    with_conn(&db, tags::usage)
}

#[tauri::command]
pub fn tag_rename(app: AppHandle, db: State<Db>, from: String, to: String) -> Result<RenameOutcome, String> {
    let outcome = run(&db, |conn| tags::rename(conn, &from, &to))?;
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(outcome)
}

#[tauri::command]
pub fn tag_delete(app: AppHandle, db: State<Db>, name: String) -> Result<(), String> {
    run(&db, |conn| tags::delete(conn, &name))?;
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn tag_delete_unused(db: State<Db>) -> Result<usize, String> {
    with_conn(&db, tags::delete_unused)
}

#[tauri::command]
pub fn tag_create(db: State<Db>, name: String) -> Result<String, String> {
    run(&db, |conn| tags::create(conn, &name))
}

#[tauri::command]
pub fn tag_toggle(app: AppHandle, db: State<Db>, target: TagTarget, name: String, on: bool) -> Result<Vec<String>, String> {
    let names = run(&db, |conn| tags::toggle(conn, target, &name, on))?;
    if matches!(target, TagTarget::Game(_)) {
        let _ = app.emit(GAMES_CHANGED_EVENT, ());
    }
    Ok(names)
}

#[tauri::command]
pub fn tag_target(db: State<Db>, target: TagTarget) -> Result<Vec<String>, String> {
    run(&db, |conn| tags::of_target(conn, target))
}
