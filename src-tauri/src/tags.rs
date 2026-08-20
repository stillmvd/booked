use rusqlite::{params, Connection};
use tauri::State;

use crate::db::{with_conn, Db};

pub fn upsert(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    let trimmed = name.trim();
    conn.execute(
        "INSERT INTO tags (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        params![trimmed],
    )?;
    conn.query_row(
        "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
        params![trimmed],
        |row| row.get(0),
    )
}

pub fn set_for_folder(
    conn: &mut Connection,
    folder_id: i64,
    names: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM folder_tags WHERE folder_id = ?1",
        params![folder_id],
    )?;
    for name in names {
        let tag_id = upsert(&tx, name)?;
        tx.execute(
            "INSERT OR IGNORE INTO folder_tags (folder_id, tag_id) VALUES (?1, ?2)",
            params![folder_id, tag_id],
        )?;
    }
    tx.commit()
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

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM tags ORDER BY name")?;
    let names = stmt
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(names)
}

#[tauri::command]
pub fn tag_list(db: State<Db>) -> Result<Vec<String>, String> {
    with_conn(&db, list_all)
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
}
