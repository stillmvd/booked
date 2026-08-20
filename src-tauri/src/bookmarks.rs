use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

use crate::db::{with_conn, Db};
use crate::url_norm::{self, ParsedUrl};

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

#[tauri::command]
pub fn bookmark_create(
    db: State<Db>,
    folder_id: Option<i64>,
    title: String,
    url: String,
    description: Option<String>,
    image: Option<String>,
) -> Result<i64, String> {
    let parsed = url_norm::parse(&url).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() { host_of(&parsed) } else { title };
    with_conn(&db, |conn| {
        create(conn, folder_id, &title, &parsed, description.as_deref(), image.as_deref())
    })
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
}
