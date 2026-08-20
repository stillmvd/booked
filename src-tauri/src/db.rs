use rusqlite::{ffi, Connection};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[derive(Debug)]
pub struct DbFailure {
    pub path: String,
    pub message: String,
}

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

const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_init.sql")];

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        conn.execute_batch(&format!("BEGIN; {sql} PRAGMA user_version = {}; COMMIT;", i + 1))?;
    }
    Ok(())
}

pub fn open_at(dir: &Path) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(dir).ok();
    std::fs::create_dir_all(dir.join("images")).ok();

    let conn = Connection::open(dir.join("trove.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(Duration::from_secs(5))?;

    let check: String = conn.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
    if check != "ok" {
        return Err(rusqlite::Error::SqliteFailure(
            ffi::Error::new(ffi::SQLITE_CORRUPT),
            Some(check),
        ));
    }

    migrate(&conn)?;
    Ok(conn)
}

pub fn open(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_local_data_dir()
        .expect("no local data dir");
    open_at(&dir)
}

fn unique_backup_path(dir: &Path, stamp: u64) -> PathBuf {
    let base = format!("trove.db.corrupt-{stamp}");
    let mut candidate = dir.join(&base);
    let mut counter = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{counter}"));
        counter += 1;
    }
    candidate
}

fn start_fresh_at_with_stamp(dir: &Path, stamp: u64) -> Result<Connection, DbFailure> {
    let db_path = dir.join("trove.db");
    if db_path.exists() {
        let backup_path = unique_backup_path(dir, stamp);
        std::fs::rename(&db_path, &backup_path).map_err(|e| DbFailure {
            path: db_path.display().to_string(),
            message: e.to_string(),
        })?;
        let backup_name = backup_path.file_name().unwrap().to_string_lossy().to_string();
        for suffix in ["-wal", "-shm"] {
            let companion = dir.join(format!("trove.db{suffix}"));
            if companion.exists() {
                std::fs::rename(&companion, dir.join(format!("{backup_name}{suffix}"))).ok();
            }
        }
    }
    open_at(dir).map_err(|e| DbFailure {
        path: db_path.display().to_string(),
        message: e.to_string(),
    })
}

pub fn start_fresh_at(dir: &Path) -> Result<Connection, DbFailure> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    start_fresh_at_with_stamp(dir, stamp)
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
    let result = start_fresh_at(&dir);
    let message = result.as_ref().err().map(|f| f.message.clone());
    *guard = result;
    match message {
        None => Ok(()),
        Some(message) => Err(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folders;
    use rusqlite::params;

    #[test]
    fn migrate_creates_schema() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        for expected in ["folders", "bookmarks", "tags", "bookmark_tags", "folder_tags"] {
            assert!(tables.iter().any(|t| t == expected), "missing table {expected}");
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn reopen_keeps_rows() {
        let dir = std::env::temp_dir().join(format!(
            "trove-test-{}-{}",
            std::process::id(),
            "reopen_keeps_rows"
        ));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("trove.db");
        let path_str = path.to_str().unwrap().to_string();

        {
            let conn = Connection::open(&path_str).unwrap();
            migrate(&conn).unwrap();
            folders::create(&conn, "Design", None).unwrap();
        }
        {
            let conn = Connection::open(&path_str).unwrap();
            migrate(&conn).unwrap();
            let contents = folders::children(&conn, None).unwrap();
            assert!(contents.folders.iter().any(|f| f.name == "Design"));
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn root_bookmark_allows_null_folder() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        conn.execute(
            "INSERT INTO bookmarks (folder_id, title, url, url_normalized) VALUES (NULL, ?1, ?2, ?3)",
            params!["Root bookmark", "https://example.test", "example.test"],
        )
        .unwrap();
    }

    #[test]
    fn cascade_removes_tag_links() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();

        conn.execute("INSERT INTO folders (name) VALUES (?1)", params!["Design"])
            .unwrap();
        let folder_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO tags (name) VALUES (?1)", params!["ui"])
            .unwrap();
        let tag_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO folder_tags (folder_id, tag_id) VALUES (?1, ?2)",
            params![folder_id, tag_id],
        )
        .unwrap();

        conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM folder_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trove-db-test-{}-{}", std::process::id(), name));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_creates_missing_database() {
        let dir = scratch_dir("open_creates_missing_database");

        let conn = open_at(&dir).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
        assert!(dir.join("trove.db").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_reports_failure_on_garbage_file() {
        let dir = scratch_dir("open_reports_failure_on_garbage_file");
        std::fs::write(dir.join("trove.db"), b"not a sqlite file at all").unwrap();

        let err = open_at(&dir).unwrap_err();
        assert!(!err.to_string().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn start_fresh_renames_and_never_deletes() {
        let dir = scratch_dir("start_fresh_renames_and_never_deletes");
        let garbage: &[u8] = b"corrupted bytes, definitely not sqlite";
        std::fs::write(dir.join("trove.db"), garbage).unwrap();

        let conn = start_fresh_at_with_stamp(&dir, 1_000_000).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);

        let backup_path = dir.join("trove.db.corrupt-1000000");
        assert!(backup_path.exists());
        let backup_bytes = std::fs::read(&backup_path).unwrap();
        assert_eq!(backup_bytes, garbage);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn start_fresh_does_not_overwrite_existing_backup() {
        let dir = scratch_dir("start_fresh_does_not_overwrite_existing_backup");
        std::fs::write(dir.join("trove.db"), b"first corruption").unwrap();
        start_fresh_at_with_stamp(&dir, 2_000_000).unwrap();

        let first_backup = dir.join("trove.db.corrupt-2000000");
        assert!(first_backup.exists());
        let first_bytes_before = std::fs::read(&first_backup).unwrap();

        std::fs::write(dir.join("trove.db"), b"second corruption").unwrap();
        start_fresh_at_with_stamp(&dir, 2_000_000).unwrap();

        let first_bytes_after = std::fs::read(&first_backup).unwrap();
        assert_eq!(first_bytes_before, first_bytes_after);

        let second_backup = dir.join("trove.db.corrupt-2000000-2");
        assert!(second_backup.exists());
        let second_bytes = std::fs::read(&second_backup).unwrap();
        assert_eq!(second_bytes, b"second corruption");

        std::fs::remove_dir_all(&dir).ok();
    }
}
