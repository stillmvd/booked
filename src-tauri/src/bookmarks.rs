use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

use crate::db::{with_conn, with_conn_mut, Db};
use trove_core::images;
use crate::tags;
use trove_core::url_norm::{self, ParsedUrl};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateHit {
    pub id: i64,
    pub title: String,
    pub folder_id: Option<i64>,
    pub folder_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub title: String,
    pub url: String,
    pub url_normalized: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub sort: i64,
    pub tags: Vec<String>,
}

fn host_of(parsed: &ParsedUrl) -> String {
    url::Url::parse(&parsed.url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_default()
}

pub fn create(
    conn: &Connection,
    folder_id: Option<i64>,
    title: &str,
    parsed: &ParsedUrl,
    description: Option<&str>,
    image: Option<&str>,
) -> rusqlite::Result<i64> {
    let description = description.filter(|d| !d.is_empty());
    conn.execute(
        "INSERT INTO bookmarks (folder_id, title, url, url_normalized, description, image) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![folder_id, title, parsed.url, parsed.normalized, description, image],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update(
    conn: &Connection,
    id: i64,
    folder_id: Option<i64>,
    title: &str,
    parsed: &ParsedUrl,
    description: Option<&str>,
    image: Option<&str>,
) -> rusqlite::Result<()> {
    let description = description.filter(|d| !d.is_empty());
    conn.execute(
        "UPDATE bookmarks SET folder_id = ?1, title = ?2, url = ?3, url_normalized = ?4, \
         description = ?5, image = ?6, updated_at = unixepoch() WHERE id = ?7",
        params![folder_id, title, parsed.url, parsed.normalized, description, image, id],
    )?;
    Ok(())
}

pub fn in_folder(conn: &Connection, folder_id: Option<i64>) -> rusqlite::Result<Vec<Bookmark>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, title, url, url_normalized, description, image, sort \
         FROM bookmarks WHERE folder_id IS ?1 ORDER BY sort, id",
    )?;
    let mut bookmarks = stmt
        .query_map(params![folder_id], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                title: row.get(2)?,
                url: row.get(3)?,
                url_normalized: row.get(4)?,
                description: row.get(5)?,
                image: row.get(6)?,
                sort: row.get(7)?,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tags_stmt = conn.prepare(
        "SELECT bt.bookmark_id, t.name FROM bookmarks b \
         JOIN bookmark_tags bt ON bt.bookmark_id = b.id \
         JOIN tags t ON t.id = bt.tag_id \
         WHERE b.folder_id IS ?1 ORDER BY b.id, t.name",
    )?;
    let tag_rows = tags_stmt
        .query_map(params![folder_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut tags_by_bookmark: HashMap<i64, Vec<String>> = HashMap::new();
    for (bookmark_id, tag_name) in tag_rows {
        tags_by_bookmark.entry(bookmark_id).or_default().push(tag_name);
    }
    for bookmark in bookmarks.iter_mut() {
        if let Some(tags) = tags_by_bookmark.remove(&bookmark.id) {
            bookmark.tags = tags;
        }
    }

    Ok(bookmarks)
}

pub fn find_by_normalized(
    conn: &Connection,
    normalized: &str,
) -> rusqlite::Result<Option<DuplicateHit>> {
    conn.query_row(
        "SELECT b.id, b.title, b.folder_id, f.name \
         FROM bookmarks b LEFT JOIN folders f ON f.id = b.folder_id \
         WHERE b.url_normalized = ?1 LIMIT 1",
        params![normalized],
        |row| {
            Ok(DuplicateHit {
                id: row.get(0)?,
                title: row.get(1)?,
                folder_id: row.get(2)?,
                folder_name: row.get(3)?,
            })
        },
    )
    .optional()
}

pub fn url_for_open(conn: &Connection, id: i64) -> Result<String, String> {
    let stored: String = conn
        .query_row("SELECT url FROM bookmarks WHERE id = ?1", params![id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let parsed = url_norm::parse(&stored).map_err(|e| e.to_string())?;
    Ok(parsed.url)
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn bookmark_open(db: State<Db>, id: i64) -> Result<(), String> {
    let url = with_conn(&db, |conn| Ok(url_for_open(conn, id)))??;
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bookmark_find_duplicate(db: State<Db>, url: String) -> Result<Option<DuplicateHit>, String> {
    let normalized = match url_norm::parse(&url) {
        Ok(parsed) => parsed.normalized,
        Err(_) => return Ok(None),
    };
    with_conn(&db, |conn| find_by_normalized(conn, &normalized))
}

#[tauri::command]
pub fn bookmark_create(
    db: State<Db>,
    folder_id: Option<i64>,
    title: String,
    url: String,
    description: Option<String>,
    image: Option<String>,
) -> Result<i64, String> {
    if let Some(filename) = &image {
        if !images::is_valid_image_filename(filename) {
            return Err("недопустимое имя файла картинки".into());
        }
    }
    let parsed = url_norm::parse(&url).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() { host_of(&parsed) } else { title };
    with_conn(&db, |conn| {
        create(conn, folder_id, &title, &parsed, description.as_deref(), image.as_deref())
    })
}

#[tauri::command]
pub fn bookmark_update(
    db: State<Db>,
    id: i64,
    folder_id: Option<i64>,
    title: String,
    url: String,
    description: Option<String>,
    image: Option<String>,
) -> Result<(), String> {
    if let Some(filename) = &image {
        if !images::is_valid_image_filename(filename) {
            return Err("недопустимое имя файла картинки".into());
        }
    }
    let parsed = url_norm::parse(&url).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() { host_of(&parsed) } else { title };
    with_conn(&db, |conn| {
        update(conn, id, folder_id, &title, &parsed, description.as_deref(), image.as_deref())
    })
}

#[tauri::command]
pub fn bookmark_set_tags(db: State<Db>, id: i64, tags: Vec<String>) -> Result<(), String> {
    with_conn_mut(&db, |conn| tags::set_for_bookmark(conn, id, &tags))
}

#[tauri::command]
pub fn bookmark_delete(db: State<Db>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| delete(conn, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::folders;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn create_writes_url_and_normalized_columns() {
        let conn = setup();
        let parsed = url_norm::parse("https://WWW.Example.COM/A/?utm_source=x").unwrap();
        let id = create(&conn, None, "Example", &parsed, None, None).unwrap();

        let (stored_url, stored_normalized): (String, String) = conn
            .query_row(
                "SELECT url, url_normalized FROM bookmarks WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored_url, "https://WWW.Example.COM/A/?utm_source=x");
        assert_eq!(stored_normalized, "https://example.com/A");
    }

    #[test]
    fn root_bookmark_is_read_via_in_folder_none() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test").unwrap();
        create(&conn, None, "Root", &parsed, None, None).unwrap();

        let bookmarks = in_folder(&conn, None).unwrap();
        assert!(bookmarks.iter().any(|b| b.title == "Root" && b.folder_id.is_none()));
    }

    #[test]
    fn folder_bookmark_is_read_via_in_folder_id() {
        let conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();
        let parsed = url_norm::parse("https://example.test/design").unwrap();
        create(&conn, Some(folder_id), "In folder", &parsed, None, None).unwrap();

        let bookmarks = in_folder(&conn, Some(folder_id)).unwrap();
        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].title, "In folder");
    }

    #[test]
    fn find_duplicate_matches_www_and_utm_variant() {
        let conn = setup();
        let parsed = url_norm::parse("https://www.example.com/a/?utm_source=x").unwrap();
        create(&conn, None, "Original", &parsed, None, None).unwrap();

        let query = url_norm::parse("https://example.com/a").unwrap();
        let hit = find_by_normalized(&conn, &query.normalized).unwrap();
        assert!(hit.is_some());
    }

    #[test]
    fn find_duplicate_returns_folder_name() {
        let conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();
        let parsed = url_norm::parse("https://example.test/design").unwrap();
        create(&conn, Some(folder_id), "Original", &parsed, None, None).unwrap();

        let hit = find_by_normalized(&conn, &parsed.normalized).unwrap().unwrap();
        assert_eq!(hit.folder_name.as_deref(), Some("Design"));
    }

    #[test]
    fn find_duplicate_root_returns_none_folder() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test/root").unwrap();
        create(&conn, None, "Original", &parsed, None, None).unwrap();

        let hit = find_by_normalized(&conn, &parsed.normalized).unwrap().unwrap();
        assert_eq!(hit.folder_id, None);
        assert_eq!(hit.folder_name, None);
    }

    #[test]
    fn find_duplicate_ignores_fragment_difference() {
        let conn = setup();
        let parsed = url_norm::parse("https://a.com/docs/api#authentication").unwrap();
        create(&conn, None, "Original", &parsed, None, None).unwrap();

        let query = url_norm::parse("https://a.com/docs/api#errors").unwrap();
        let hit = find_by_normalized(&conn, &query.normalized).unwrap();
        assert!(hit.is_none());
    }

    #[test]
    fn duplicate_url_can_be_saved_anyway_plain_index() {
        let conn = setup();
        let first_parsed = url_norm::parse("https://example.com/a?utm_source=x").unwrap();
        let first_id = create(&conn, None, "Original", &first_parsed, None, None).unwrap();

        let second_parsed = url_norm::parse("https://www.example.com/a").unwrap();
        let second_id = create(&conn, None, "Saved anyway", &second_parsed, None, None).unwrap();

        assert_ne!(first_id, second_id);
        assert_eq!(first_parsed.normalized, second_parsed.normalized);

        let bookmarks = in_folder(&conn, None).unwrap();
        let first = bookmarks.iter().find(|b| b.id == first_id).unwrap();
        let second = bookmarks.iter().find(|b| b.id == second_id).unwrap();
        assert_eq!(first.url_normalized, second.url_normalized);
    }

    #[test]
    fn open_rejects_non_http_scheme() {
        let conn = setup();
        let id = {
            let parsed = url_norm::parse("https://example.test").unwrap();
            create(&conn, None, "Original", &parsed, None, None).unwrap()
        };
        conn.execute(
            "UPDATE bookmarks SET url = ?1 WHERE id = ?2",
            params!["javascript:alert(1)", id],
        )
        .unwrap();

        let err = url_for_open(&conn, id).unwrap_err();
        assert_eq!(err, url_norm::UrlError::UnsupportedScheme.to_string());
    }

    #[test]
    fn update_keeps_url_and_normalized_in_sync() {
        let conn = setup();
        let old_parsed = url_norm::parse("https://example.test/old").unwrap();
        let id = create(&conn, None, "Original", &old_parsed, None, None).unwrap();

        let new_parsed = url_norm::parse("https://WWW.Example.TEST/new/?utm_source=x").unwrap();
        update(&conn, id, None, "Renamed", &new_parsed, None, None).unwrap();

        let (stored_url, stored_normalized): (String, String) = conn
            .query_row(
                "SELECT url, url_normalized FROM bookmarks WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored_url, "https://WWW.Example.TEST/new/?utm_source=x");
        assert_eq!(stored_normalized, "https://example.test/new");
    }

    #[test]
    fn update_writes_null_for_empty_description() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test").unwrap();
        let id = create(&conn, None, "Original", &parsed, Some("was set"), None).unwrap();

        update(&conn, id, None, "Original", &parsed, Some(""), None).unwrap();

        let description: Option<String> = conn
            .query_row(
                "SELECT description FROM bookmarks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(description, None);
    }

    #[test]
    fn bookmark_image_reuses_shared_images_import() {
        let conn = setup();
        let scratch = std::env::temp_dir().join(format!(
            "trove-bookmark-image-test-{}",
            std::process::id()
        ));
        let source = scratch.join("source.png");
        std::fs::create_dir_all(&scratch).unwrap();
        std::fs::write(&source, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();

        let filename = trove_core::images::import(&scratch.join("images"), &source).unwrap();

        let parsed = url_norm::parse("https://example.test").unwrap();
        let id = create(&conn, None, "With image", &parsed, None, Some(&filename)).unwrap();

        let stored: Option<String> = conn
            .query_row("SELECT image FROM bookmarks WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, Some(filename));
    }

    #[test]
    fn delete_removes_row_and_tag_links() {
        let mut conn = setup();
        let parsed = url_norm::parse("https://example.test/gone").unwrap();
        let id = create(&conn, None, "Gone", &parsed, None, None).unwrap();
        tags::set_for_bookmark(&mut conn, id, &["ui".to_string()]).unwrap();

        delete(&conn, id).unwrap();

        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmarks WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(row_count, 0);

        let link_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmark_tags WHERE bookmark_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(link_count, 0);
    }

    #[test]
    fn delete_does_not_touch_other_rows() {
        let conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();
        let kept_parsed = url_norm::parse("https://example.test/kept").unwrap();
        let kept_id = create(&conn, Some(folder_id), "Kept", &kept_parsed, None, None).unwrap();
        let gone_parsed = url_norm::parse("https://example.test/gone2").unwrap();
        let gone_id = create(&conn, Some(folder_id), "Gone", &gone_parsed, None, None).unwrap();

        delete(&conn, gone_id).unwrap();

        let remaining = in_folder(&conn, Some(folder_id)).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, kept_id);
    }
}
