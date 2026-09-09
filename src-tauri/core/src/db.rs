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
    include_str!("../../migrations/003_view_state.sql"),
    include_str!("../../migrations/004_preview_cache.sql"),
    include_str!("../../migrations/005_search_index.sql"),
    include_str!("../../migrations/006_browser_and_liveness.sql"),
    include_str!("../../migrations/007_folder_sort.sql"),
    include_str!("../../migrations/008_folder_browser.sql"),
    include_str!("../../migrations/009_games.sql"),
    include_str!("../../migrations/010_game_cover_pos.sql"),
    include_str!("../../migrations/011_game_title_source.sql"),
    include_str!("../../migrations/012_game_engine.sql"),
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
    std::fs::create_dir_all(dir.join("previews")).ok();
    std::fs::create_dir_all(dir.join("icons")).ok();
    std::fs::create_dir_all(dir.join("avatars")).ok();

    let conn = Connection::open(dir.join("booked.db"))?;
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

    let fts5_enabled: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_compile_options WHERE compile_options = 'ENABLE_FTS5'",
        [],
        |row| row.get(0),
    )?;
    if fts5_enabled == 0 {
        return Err(rusqlite::Error::SqliteFailure(
            ffi::Error::new(ffi::SQLITE_CORRUPT),
            Some("сборка SQLite собрана без FTS5 — поиск недоступен".to_string()),
        ));
    }

    migrate(&conn)?;
    Ok(conn)
}

fn unique_backup_path(dir: &Path, stamp: u64) -> PathBuf {
    let base = format!("booked.db.corrupt-{stamp}");
    let mut candidate = dir.join(&base);
    let mut counter = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{counter}"));
        counter += 1;
    }
    candidate
}

fn start_fresh_at_with_stamp(dir: &Path, stamp: u64) -> Result<Connection, DbFailure> {
    let db_path = dir.join("booked.db");
    if db_path.exists() {
        let backup_path = unique_backup_path(dir, stamp);
        std::fs::rename(&db_path, &backup_path).map_err(|e| DbFailure {
            path: db_path.display().to_string(),
            message: e.to_string(),
        })?;
        let backup_name = backup_path.file_name().unwrap().to_string_lossy().to_string();
        for suffix in ["-wal", "-shm"] {
            let companion = dir.join(format!("booked.db{suffix}"));
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
    use crate::{bookmarks, folders, tags, url_norm};
    use rusqlite::params;

    #[test]
    fn migrate_creates_schema() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        for expected in [
            "folders",
            "bookmarks",
            "tags",
            "bookmark_tags",
            "folder_tags",
            "settings",
            "favicons",
            "games",
            "game_tags",
        ] {
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
        assert_eq!(version, MIGRATIONS.len() as i64);

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
    fn migrate_upgrades_existing_v3_database_keeps_bookmark() {
        let conn = Connection::open_in_memory().unwrap();
        let v3_sql = format!("{}{}{}", MIGRATIONS[0], MIGRATIONS[1], MIGRATIONS[2]);
        conn.execute_batch(&format!("BEGIN; {v3_sql} PRAGMA user_version = 3; COMMIT;"))
            .unwrap();
        conn.execute(
            "INSERT INTO bookmarks (folder_id, title, url, url_normalized, image) \
             VALUES (NULL, ?1, ?2, ?3, ?4)",
            params!["Kept", "https://example.test/kept", "example.test/kept", "abc123.png"],
        )
        .unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let (title, image): (String, Option<String>) = conn
            .query_row(
                "SELECT title, image FROM bookmarks WHERE title = 'Kept'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "Kept");
        assert_eq!(image.as_deref(), Some("abc123.png"));
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }

    #[test]
    fn reopen_keeps_rows() {
        let dir = std::env::temp_dir().join(format!(
            "booked-test-{}-{}",
            std::process::id(),
            "reopen_keeps_rows"
        ));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("booked.db");
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
        let dir = std::env::temp_dir().join(format!("booked-db-test-{}-{}", std::process::id(), name));
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
        assert_eq!(version, MIGRATIONS.len() as i64);
        assert!(dir.join("booked.db").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn open_reports_failure_on_garbage_file() {
        let dir = scratch_dir("open_reports_failure_on_garbage_file");
        std::fs::write(dir.join("booked.db"), b"not a sqlite file at all").unwrap();

        let err = open_at(&dir).unwrap_err();
        assert!(!err.to_string().is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn start_fresh_renames_and_never_deletes() {
        let dir = scratch_dir("start_fresh_renames_and_never_deletes");
        let garbage: &[u8] = b"corrupted bytes, definitely not sqlite";
        std::fs::write(dir.join("booked.db"), garbage).unwrap();

        let conn = start_fresh_at_with_stamp(&dir, 1_000_000).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let backup_path = dir.join("booked.db.corrupt-1000000");
        assert!(backup_path.exists());
        let backup_bytes = std::fs::read(&backup_path).unwrap();
        assert_eq!(backup_bytes, garbage);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn start_fresh_does_not_overwrite_existing_backup() {
        let dir = scratch_dir("start_fresh_does_not_overwrite_existing_backup");
        std::fs::write(dir.join("booked.db"), b"first corruption").unwrap();
        start_fresh_at_with_stamp(&dir, 2_000_000).unwrap();

        let first_backup = dir.join("booked.db.corrupt-2000000");
        assert!(first_backup.exists());
        let first_bytes_before = std::fs::read(&first_backup).unwrap();

        std::fs::write(dir.join("booked.db"), b"second corruption").unwrap();
        start_fresh_at_with_stamp(&dir, 2_000_000).unwrap();

        let first_bytes_after = std::fs::read(&first_backup).unwrap();
        assert_eq!(first_bytes_before, first_bytes_after);

        let second_backup = dir.join("booked.db.corrupt-2000000-2");
        assert!(second_backup.exists());
        let second_bytes = std::fs::read(&second_backup).unwrap();
        assert_eq!(second_bytes, b"second corruption");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrate_upgrades_existing_v4_database_keeps_data_and_populates_index() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let v4_sql = format!("{}{}{}{}", MIGRATIONS[0], MIGRATIONS[1], MIGRATIONS[2], MIGRATIONS[3]);
        conn.execute_batch(&format!("BEGIN; {v4_sql} PRAGMA user_version = 4; COMMIT;"))
            .unwrap();

        let folder_id = folders::create(&conn, "Design", None).unwrap();
        conn.execute(
            "INSERT INTO bookmarks (folder_id, title, url, url_normalized) VALUES (?1, ?2, ?3, ?4)",
            params![
                Some(folder_id),
                "Grid guide",
                "https://example.test/grid",
                "https://example.test/grid"
            ],
        )
        .unwrap();
        let bookmark_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO tags (name, name_normalized) VALUES (?1, ?2)",
            params!["ui", "ui"],
        )
        .unwrap();
        let tag_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?1, ?2)",
            params![bookmark_id, tag_id],
        )
        .unwrap();

        migrate(&conn).unwrap();

        let title: String = conn
            .query_row("SELECT title FROM bookmarks WHERE id = ?1", params![bookmark_id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(title, "Grid guide");

        let folder_name: String = conn
            .query_row("SELECT name FROM folders WHERE id = ?1", params![folder_id], |row| row.get(0))
            .unwrap();
        assert_eq!(folder_name, "Design");

        let matched: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH '\"grid\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(matched, 1);
    }

    #[test]
    fn cyrillic_query_matches_bookmark_title_case_insensitively() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO bookmarks (folder_id, title, url, url_normalized) VALUES (NULL, ?1, ?2, ?3)",
            params!["Гриды в вёрстке", "https://example.test/grid", "https://example.test/grid"],
        )
        .unwrap();

        let found: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH '\"ГРИД\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, 1);

        let not_found: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH '\"отсутствует\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(not_found, 0);
    }

    #[test]
    fn generated_host_column_covers_port_no_path_query_and_schemeless() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let cases = [
            ("https://example.test:8443/page", "example.test:8443"),
            ("https://example.test", "example.test"),
            ("https://example.test/?x=1", "example.test"),
            ("not-a-url-at-all", ""),
        ];
        for (i, (url, expected_host)) in cases.iter().enumerate() {
            conn.execute(
                "INSERT INTO bookmarks (folder_id, title, url, url_normalized) VALUES (NULL, ?1, ?2, ?3)",
                params![format!("case {i}"), url, url],
            )
            .unwrap();
            let id = conn.last_insert_rowid();
            let host: String = conn
                .query_row("SELECT host FROM bookmarks WHERE id = ?1", params![id], |row| row.get(0))
                .unwrap();
            assert_eq!(&host, expected_host, "host mismatch for {url}");
        }
    }

    #[test]
    fn move_to_rewrites_path_for_subtree() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();

        let a = folders::create(&conn, "A", None).unwrap();
        let b = folders::create(&conn, "B", None).unwrap();
        let child = folders::create(&conn, "Child", Some(a)).unwrap();

        folders::move_to(&mut conn, a, Some(b)).unwrap();

        let a_path: String = conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![a], |row| row.get(0))
            .unwrap();
        let b_path: String = conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![b], |row| row.get(0))
            .unwrap();
        let child_path: String = conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![child], |row| row.get(0))
            .unwrap();

        assert!(a_path.starts_with(&b_path));
        assert!(child_path.starts_with(&a_path));
    }

    #[test]
    fn delete_promote_rewrites_path_for_promoted_children() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();

        let top = folders::create(&conn, "Top", None).unwrap();
        let middle = folders::create(&conn, "Middle", Some(top)).unwrap();
        let child = folders::create(&conn, "Child", Some(middle)).unwrap();

        let top_path: String = conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![top], |row| row.get(0))
            .unwrap();

        folders::delete(&mut conn, middle, folders::DeleteMode::Promote).unwrap();

        let child_path: String = conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![child], |row| row.get(0))
            .unwrap();
        assert!(child_path.starts_with(&top_path));
        assert!(!child_path.contains(&format!("/{middle}/")));
    }

    #[test]
    fn integrity_check_passes_after_lifecycle_changes() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();

        let folder_id = folders::create(&conn, "Design", None).unwrap();
        let parsed = url_norm::parse("https://example.test/int").unwrap();
        let bookmark_id = bookmarks::create(&conn, Some(folder_id), "Integrity", &parsed, None, None).unwrap();
        tags::set_for_bookmark(&mut conn, bookmark_id, &["ui".to_string()]).unwrap();

        let updated = url_norm::parse("https://example.test/int2").unwrap();
        bookmarks::update(&conn, bookmark_id, Some(folder_id), "Renamed", &updated, None, None).unwrap();
        tags::set_for_bookmark(&mut conn, bookmark_id, &["design".to_string()]).unwrap();

        folders::update_with_tags(&mut conn, folder_id, "Design renamed", None, None, &["work".to_string()])
            .unwrap();

        bookmarks::delete(&conn, bookmark_id).unwrap();
        folders::delete(&mut conn, folder_id, folders::DeleteMode::All).unwrap();

        conn.execute_batch("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('integrity-check');")
            .unwrap();
        conn.execute_batch("INSERT INTO folders_fts(folders_fts) VALUES('integrity-check');")
            .unwrap();
    }

    #[test]
    fn migrate_upgrades_existing_v5_database_keeps_data_and_passes_integrity() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let v5_sql = format!(
            "{}{}{}{}{}",
            MIGRATIONS[0], MIGRATIONS[1], MIGRATIONS[2], MIGRATIONS[3], MIGRATIONS[4]
        );
        conn.execute_batch(&format!("BEGIN; {v5_sql} PRAGMA user_version = 5; COMMIT;"))
            .unwrap();

        let folder_id = folders::create(&conn, "Design", None).unwrap();
        let parsed = url_norm::parse("https://example.test/pre-migration").unwrap();
        let bookmark_id = bookmarks::create(&conn, Some(folder_id), "Pre migration", &parsed, None, None).unwrap();
        tags::set_for_bookmark(&mut conn, bookmark_id, &["ui".to_string()]).unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let title: String = conn
            .query_row("SELECT title FROM bookmarks WHERE id = ?1", params![bookmark_id], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "Pre migration");

        let folder_name: String = conn
            .query_row("SELECT name FROM folders WHERE id = ?1", params![folder_id], |row| row.get(0))
            .unwrap();
        assert_eq!(folder_name, "Design");

        let tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmark_tags WHERE bookmark_id = ?1",
                params![bookmark_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 1);

        let fail_count: i64 = conn
            .query_row("SELECT fail_count FROM bookmarks WHERE id = ?1", params![bookmark_id], |row| row.get(0))
            .unwrap();
        assert_eq!(fail_count, 0);

        conn.execute_batch("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('integrity-check');")
            .unwrap();
        conn.execute_batch("INSERT INTO folders_fts(folders_fts) VALUES('integrity-check');")
            .unwrap();
    }

    #[test]
    fn migrate_upgrades_existing_v11_database_keeps_games_and_adds_engine() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let v11_sql: String = MIGRATIONS[..11].concat();
        conn.execute_batch(&format!("BEGIN; {v11_sql} PRAGMA user_version = 11; COMMIT;"))
            .unwrap();
        conn.execute(
            "INSERT INTO games (base_name, title, folder_path, folder_name) \
             VALUES ('julia', 'Unmasking Julia', 'D:/games/Julia', 'Julia')",
            [],
        )
        .unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let (title, engine): (String, Option<String>) = conn
            .query_row("SELECT title, engine FROM games WHERE base_name = 'julia'", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(title, "Unmasking Julia");
        assert_eq!(engine, None, "existing game keeps unknown engine until it is scanned");
    }

    #[test]
    fn migrate_upgrades_existing_v6_database_keeps_manual_order_and_passes_integrity() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let v6_sql = format!(
            "{}{}{}{}{}{}",
            MIGRATIONS[0], MIGRATIONS[1], MIGRATIONS[2], MIGRATIONS[3], MIGRATIONS[4], MIGRATIONS[5]
        );
        conn.execute_batch(&format!("BEGIN; {v6_sql} PRAGMA user_version = 6; COMMIT;"))
            .unwrap();

        let folder_id = folders::create(&conn, "Design", None).unwrap();
        let parsed = url_norm::parse("https://example.test/pre-sort").unwrap();
        let bookmark_id = bookmarks::create(&conn, Some(folder_id), "Pre sort", &parsed, None, None).unwrap();
        tags::set_for_bookmark(&mut conn, bookmark_id, &["ui".to_string()]).unwrap();

        migrate(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let mut stmt = conn.prepare("PRAGMA table_info(folders)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(columns.iter().any(|c| c == "sort_key"), "missing sort_key column");
        assert!(columns.iter().any(|c| c == "sort_dir"), "missing sort_dir column");

        let (sort_key, sort_dir): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT sort_key, sort_dir FROM folders WHERE id = ?1",
                params![folder_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(sort_key, None, "existing folder must stay in manual order after upgrade");
        assert_eq!(sort_dir, None);

        let title: String = conn
            .query_row("SELECT title FROM bookmarks WHERE id = ?1", params![bookmark_id], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "Pre sort");

        let folder_name: String = conn
            .query_row("SELECT name FROM folders WHERE id = ?1", params![folder_id], |row| row.get(0))
            .unwrap();
        assert_eq!(folder_name, "Design");

        let tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmark_tags WHERE bookmark_id = ?1",
                params![bookmark_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 1);

        conn.execute_batch("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('integrity-check');")
            .unwrap();
        conn.execute_batch("INSERT INTO folders_fts(folders_fts) VALUES('integrity-check');")
            .unwrap();
    }

    #[test]
    fn open_at_upgrades_v6_file_preserves_visual_folder_order() {
        let dir = scratch_dir("open_at_upgrades_v6_file_preserves_visual_folder_order");
        let db_path = dir.join("booked.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            let v6_sql = format!(
                "{}{}{}{}{}{}",
                MIGRATIONS[0], MIGRATIONS[1], MIGRATIONS[2], MIGRATIONS[3], MIGRATIONS[4], MIGRATIONS[5]
            );
            conn.execute_batch(&format!("BEGIN; {v6_sql} PRAGMA user_version = 6; COMMIT;"))
                .unwrap();

            let gamma = folders::create(&conn, "Gamma", None).unwrap();
            let alpha = folders::create(&conn, "Alpha", None).unwrap();
            let beta = folders::create(&conn, "Beta", None).unwrap();
            conn.execute("UPDATE folders SET sort = 2 WHERE id = ?1", params![gamma]).unwrap();
            conn.execute("UPDATE folders SET sort = 0 WHERE id = ?1", params![alpha]).unwrap();
            conn.execute("UPDATE folders SET sort = 1 WHERE id = ?1", params![beta]).unwrap();

            let mut stmt = conn.prepare("SELECT name FROM folders WHERE parent_id IS NULL ORDER BY sort, id").unwrap();
            let names_before: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            assert_eq!(names_before, vec!["Alpha", "Beta", "Gamma"], "sanity: shuffled sort must not equal id order");
        }

        let conn = open_at(&dir).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);

        let after = folders::children(&conn, None).unwrap();
        let names_after: Vec<String> = after.folders.iter().map(|f| f.name.clone()).collect();
        assert_eq!(names_after, vec!["Alpha", "Beta", "Gamma"], "visual order must survive migration 007 unchanged");

        for folder in &after.folders {
            assert_eq!(folder.sort, match folder.name.as_str() {
                "Alpha" => 0,
                "Beta" => 1,
                "Gamma" => 2,
                other => panic!("unexpected folder {other}"),
            });
        }

        let mut stmt = conn.prepare("SELECT sort_key, sort_dir FROM folders ORDER BY id").unwrap();
        let sort_modes: Vec<(Option<String>, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(
            sort_modes.iter().all(|(k, d)| k.is_none() && d.is_none()),
            "no existing folder may pick up a sort mode from the migration itself"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn liveness_columns_do_not_reindex_fts() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let parsed = url_norm::parse("https://example.test/liveness").unwrap();
        let bookmark_id = bookmarks::create(&conn, None, "Liveness target", &parsed, None, None).unwrap();

        let count_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmarks_fts", [], |row| row.get(0))
            .unwrap();
        let matched_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH '\"liveness\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        conn.execute(
            "UPDATE bookmarks SET link_status = 'dead', last_checked_at = 1 WHERE id = ?1",
            params![bookmark_id],
        )
        .unwrap();

        let count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmarks_fts", [], |row| row.get(0))
            .unwrap();
        let matched_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH '\"liveness\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(count_before, count_after);
        assert_eq!(matched_before, matched_after);
    }
}
