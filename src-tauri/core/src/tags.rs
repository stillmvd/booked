use rusqlite::{params, Connection};
use serde::Serialize;

pub fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}

pub fn upsert(conn: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let normalized = normalize(name);
    conn.execute(
        "INSERT INTO tags (name, name_normalized) VALUES (?1, ?2) \
         ON CONFLICT(name_normalized) DO NOTHING",
        params![trimmed, normalized],
    )?;
    conn.query_row(
        "SELECT id FROM tags WHERE name_normalized = ?1",
        params![normalized],
        |row| row.get(0),
    )
    .map(Some)
}

pub fn set_for_folder(
    conn: &mut Connection,
    folder_id: i64,
    names: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    set_for_folder_tx(&tx, folder_id, names)?;
    tx.commit()
}

pub fn set_for_folder_tx(
    conn: &Connection,
    folder_id: i64,
    names: &[String],
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM folder_tags WHERE folder_id = ?1",
        params![folder_id],
    )?;
    for name in names {
        let Some(tag_id) = upsert(conn, name)? else {
            continue;
        };
        conn.execute(
            "INSERT OR IGNORE INTO folder_tags (folder_id, tag_id) VALUES (?1, ?2)",
            params![folder_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn for_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t JOIN folder_tags ft ON ft.tag_id = t.id \
         WHERE ft.folder_id = ?1 ORDER BY t.name",
    )?;
    let names = stmt
        .query_map(params![folder_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(names)
}

pub fn set_for_bookmark(
    conn: &mut Connection,
    bookmark_id: i64,
    names: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM bookmark_tags WHERE bookmark_id = ?1",
        params![bookmark_id],
    )?;
    for name in names {
        let Some(tag_id) = upsert(&tx, name)? else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?1, ?2)",
            params![bookmark_id, tag_id],
        )?;
    }
    tx.commit()
}

pub fn for_bookmark(conn: &Connection, bookmark_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t JOIN bookmark_tags bt ON bt.tag_id = t.id \
         WHERE bt.bookmark_id = ?1 ORDER BY t.name",
    )?;
    let names = stmt
        .query_map(params![bookmark_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(names)
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM tags ORDER BY name")?;
    let names = stmt
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(names)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

pub fn counts(conn: &Connection) -> rusqlite::Result<Vec<TagCount>> {
    let mut stmt = conn.prepare(
        "SELECT t.name, \
             (SELECT COUNT(*) FROM bookmark_tags bt WHERE bt.tag_id = t.id) + \
             (SELECT COUNT(*) FROM folder_tags ft WHERE ft.tag_id = t.id) AS cnt \
         FROM tags t \
         ORDER BY cnt DESC, t.name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TagCount {
            name: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect()
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
    fn set_for_folder_replaces_set() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();

        set_for_folder(
            &mut conn,
            folder_id,
            &["a".to_string(), "b".to_string()],
        )
        .unwrap();
        set_for_folder(&mut conn, folder_id, &["c".to_string()]).unwrap();

        let tags = for_folder(&conn, folder_id).unwrap();
        assert_eq!(tags, vec!["c".to_string()]);
    }

    #[test]
    fn tag_names_are_case_insensitive() {
        let conn = setup();
        let id1 = upsert(&conn, "Design").unwrap();
        let id2 = upsert(&conn, "design").unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn cyrillic_tag_names_are_case_insensitive() {
        let conn = setup();
        let id1 = upsert(&conn, "Работа").unwrap();
        let id2 = upsert(&conn, "работа").unwrap();
        let id3 = upsert(&conn, "РАБОТА").unwrap();
        assert_eq!(id1, id2);
        assert_eq!(id1, id3);

        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn upsert_preserves_original_casing_for_display() {
        let conn = setup();
        upsert(&conn, "GitHub").unwrap();
        upsert(&conn, "github").unwrap();

        let stored: String = conn
            .query_row("SELECT name FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, "GitHub");
    }

    #[test]
    fn upsert_of_blank_name_returns_none_and_creates_no_row() {
        let conn = setup();
        let id = upsert(&conn, "   ").unwrap();
        assert_eq!(id, None);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn set_for_folder_skips_blank_tag_names() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();

        set_for_folder(&mut conn, folder_id, &["ui".to_string(), "   ".to_string(), "".to_string()])
            .unwrap();

        let tags = for_folder(&conn, folder_id).unwrap();
        assert_eq!(tags, vec!["ui".to_string()]);
    }

    #[test]
    fn deleting_folder_cascades_links() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();
        set_for_folder(&mut conn, folder_id, &["ui".to_string()]).unwrap();

        conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM folder_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn set_for_bookmark_replaces_set() {
        use crate::bookmarks;
        use crate::url_norm;

        let conn = setup();
        let parsed = url_norm::parse("https://example.test").unwrap();
        let bookmark_id = bookmarks::create(&conn, None, "Example", &parsed, None, None).unwrap();

        let mut conn = conn;
        set_for_bookmark(&mut conn, bookmark_id, &["a".to_string(), "b".to_string()]).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["c".to_string()]).unwrap();

        let tags = for_bookmark(&conn, bookmark_id).unwrap();
        assert_eq!(tags, vec!["c".to_string()]);
    }

    #[test]
    fn deleting_bookmark_cascades_tag_links() {
        use crate::bookmarks;
        use crate::url_norm;

        let mut conn = setup();
        let parsed = url_norm::parse("https://example.test").unwrap();
        let bookmark_id = bookmarks::create(&conn, None, "Example", &parsed, None, None).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["ui".to_string()]).unwrap();

        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmark_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn counts_sums_bookmark_and_folder_links() {
        use crate::bookmarks;
        use crate::url_norm;

        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();
        set_for_folder(&mut conn, folder_id, &["shared".to_string()]).unwrap();

        let parsed = url_norm::parse("https://example.test").unwrap();
        let bookmark_id = bookmarks::create(&conn, None, "Example", &parsed, None, None).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["shared".to_string()]).unwrap();

        let all = counts(&conn).unwrap();
        let shared = all.iter().find(|c| c.name == "shared").unwrap();
        assert_eq!(shared.count, 2);
    }

    #[test]
    fn counts_sorts_by_count_descending_then_by_name() {
        let mut conn = setup();
        let a = folders::create(&conn, "A", None).unwrap();
        let b = folders::create(&conn, "B", None).unwrap();
        let c = folders::create(&conn, "C", None).unwrap();
        set_for_folder(&mut conn, a, &["popular".to_string(), "zeta".to_string()]).unwrap();
        set_for_folder(&mut conn, b, &["popular".to_string(), "alpha".to_string()]).unwrap();
        set_for_folder(&mut conn, c, &["popular".to_string()]).unwrap();

        let all = counts(&conn).unwrap();
        let names: Vec<&str> = all.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["popular", "alpha", "zeta"]);
    }

    #[test]
    fn unattached_tag_has_zero_count_and_is_present() {
        let conn = setup();
        upsert(&conn, "одинокий").unwrap();

        let all = counts(&conn).unwrap();
        let lonely = all.iter().find(|c| c.name == "одинокий").unwrap();
        assert_eq!(lonely.count, 0);
    }

    #[test]
    fn cyrillic_tags_give_one_combined_count() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Работа", None).unwrap();
        set_for_folder(&mut conn, folder_id, &["Работа".to_string()]).unwrap();

        let parsed = crate::url_norm::parse("https://example.test/w").unwrap();
        let bookmark_id =
            crate::bookmarks::create(&conn, None, "Пример", &parsed, None, None).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["работа".to_string()]).unwrap();

        let all = counts(&conn).unwrap();
        let matches: Vec<_> = all.iter().filter(|c| c.name.to_lowercase() == "работа").collect();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].count, 2);
    }
}
