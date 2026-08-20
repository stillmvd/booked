use rusqlite::{ffi, Connection};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

pub struct DbFailure {
    pub path: String,
    pub message: String,
}

pub struct Db(pub Mutex<Result<Connection, DbFailure>>);

const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_init.sql")];

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        conn.execute_batch(&format!("BEGIN; {sql} PRAGMA user_version = {}; COMMIT;", i + 1))?;
    }
    Ok(())
}

pub fn open(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_local_data_dir()
        .expect("no local data dir");
    std::fs::create_dir_all(&dir).ok();
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
        let path = std::env::temp_dir().join(format!(
            "trove-test-{}-{}.db",
            std::process::id(),
            "reopen_keeps_rows"
        ));
        let path_str = path.to_str().unwrap().to_string();
        std::fs::remove_file(&path_str).ok();

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

        std::fs::remove_file(&path_str).ok();
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
}
