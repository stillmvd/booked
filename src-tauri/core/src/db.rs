use rusqlite::{ffi, Connection};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub struct DbFailure {
    pub path: String,
    pub message: String,
}

const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/001_init.sql"),
    include_str!("../../migrations/002_tags_normalized.sql"),
];

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
        assert_eq!(version, 2);

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
    fn migrate_upgrades_existing_v1_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&format!(
            "BEGIN; {} PRAGMA user_version = 1; COMMIT;",
            MIGRATIONS[0]
        ))
        .unwrap();
        conn.execute("INSERT INTO tags (name) VALUES (?1)", params!["Design"])
            .unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);

        let normalized: String = conn
            .query_row("SELECT name_normalized FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(normalized, "design");

        let name: String = conn
            .query_row("SELECT name FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "Design");
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
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
        assert_eq!(version, 2);
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
        assert_eq!(version, 2);

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
