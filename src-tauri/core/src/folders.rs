use rusqlite::{params, Connection, ToSql};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::bookmarks::{self, Bookmark};
use crate::tags;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Crumb {
    pub id: i64,
    pub name: String,
}

#[derive(Debug)]
pub enum MoveError {
    Cycle,
    Sql(rusqlite::Error),
}

impl From<rusqlite::Error> for MoveError {
    fn from(e: rusqlite::Error) -> Self {
        MoveError::Sql(e)
    }
}

impl std::fmt::Display for MoveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MoveError::Cycle => write!(f, "cycle"),
            MoveError::Sql(e) => write!(f, "{e}"),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub sort: i64,
    pub tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRef {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderContents {
    pub folders: Vec<Folder>,
    pub bookmarks: Vec<Bookmark>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentsCount {
    pub bookmarks: i64,
    pub folders: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeleteMode {
    All,
    Promote,
}

pub fn create(conn: &Connection, name: &str, parent_id: Option<i64>) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO folders (parent_id, name) VALUES (?1, ?2)",
        params![parent_id, name],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn children(conn: &Connection, parent_id: Option<i64>) -> rusqlite::Result<FolderContents> {
    let mut folder_stmt = conn.prepare(
        "SELECT id, parent_id, name, description, image, sort \
         FROM folders WHERE parent_id IS ?1 ORDER BY sort, id",
    )?;
    let mut folders = folder_stmt
        .query_map(params![parent_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                image: row.get(4)?,
                sort: row.get(5)?,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tags_stmt = conn.prepare(
        "SELECT f.id, t.name FROM folders f \
         JOIN folder_tags ft ON ft.folder_id = f.id \
         JOIN tags t ON t.id = ft.tag_id \
         WHERE f.parent_id IS ?1 ORDER BY f.id, t.name",
    )?;
    let tag_rows = tags_stmt
        .query_map(params![parent_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut tags_by_folder: HashMap<i64, Vec<String>> = HashMap::new();
    for (folder_id, tag_name) in tag_rows {
        tags_by_folder.entry(folder_id).or_default().push(tag_name);
    }
    for folder in folders.iter_mut() {
        if let Some(tags) = tags_by_folder.remove(&folder.id) {
            folder.tags = tags;
        }
    }

    let bookmarks = bookmarks::in_folder(conn, parent_id)?;

    Ok(FolderContents { folders, bookmarks })
}

pub fn breadcrumbs(conn: &Connection, id: i64) -> rusqlite::Result<Vec<Crumb>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE up(id, parent_id, name, depth) AS ( \
             SELECT id, parent_id, name, 0 FROM folders WHERE id = ?1 \
             UNION ALL \
             SELECT f.id, f.parent_id, f.name, up.depth + 1 \
             FROM folders f JOIN up ON f.id = up.parent_id \
             WHERE up.depth < 64 \
         ) SELECT id, name FROM up ORDER BY depth DESC",
    )?;
    let crumbs = stmt
        .query_map(params![id], |row| {
            Ok(Crumb {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(crumbs)
}

pub fn subtree_ids(conn: &Connection, root: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE down(id, depth) AS ( \
             SELECT id, 0 FROM folders WHERE id = ?1 \
             UNION ALL \
             SELECT f.id, down.depth + 1 \
             FROM folders f JOIN down ON f.parent_id = down.id \
             WHERE down.depth < 64 \
         ) SELECT id FROM down",
    )?;
    let ids = stmt
        .query_map(params![root], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(ids)
}

pub fn contents_count(conn: &Connection, id: i64) -> rusqlite::Result<ContentsCount> {
    let ids = subtree_ids(conn, id)?;
    if ids.is_empty() {
        return Ok(ContentsCount { bookmarks: 0, folders: 0 });
    }
    let folder_count = ids.len() as i64 - 1;

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT COUNT(*) FROM bookmarks WHERE folder_id IN ({placeholders})");
    let bind_ids: Vec<&dyn ToSql> = ids.iter().map(|id| id as &dyn ToSql).collect();
    let mut stmt = conn.prepare(&sql)?;
    let bookmark_count: i64 = stmt.query_row(bind_ids.as_slice(), |row| row.get(0))?;

    Ok(ContentsCount { bookmarks: bookmark_count, folders: folder_count })
}

pub fn delete(conn: &mut Connection, id: i64, mode: DeleteMode) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    if let DeleteMode::Promote = mode {
        let new_parent: Option<i64> = tx.query_row(
            "SELECT parent_id FROM folders WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE folders SET parent_id = ?1, updated_at = unixepoch() WHERE parent_id = ?2",
            params![new_parent, id],
        )?;
        tx.execute(
            "UPDATE bookmarks SET folder_id = ?1, updated_at = unixepoch() WHERE folder_id = ?2",
            params![new_parent, id],
        )?;
    }
    tx.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(())
}

pub fn move_to(conn: &mut Connection, id: i64, new_parent: Option<i64>) -> Result<(), MoveError> {
    let tx = conn.transaction()?;
    if let Some(new_parent_id) = new_parent {
        if new_parent_id == id || subtree_ids(&tx, id)?.contains(&new_parent_id) {
            return Err(MoveError::Cycle);
        }
    }
    tx.execute(
        "UPDATE folders SET parent_id = ?1, updated_at = unixepoch() WHERE id = ?2",
        params![new_parent, id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    description: Option<&str>,
    image: Option<&str>,
) -> rusqlite::Result<()> {
    let description = description.filter(|d| !d.is_empty());
    conn.execute(
        "UPDATE folders SET name = ?1, description = ?2, image = ?3, updated_at = unixepoch() \
         WHERE id = ?4",
        params![name, description, image, id],
    )?;
    Ok(())
}

pub fn update_with_tags(
    conn: &mut Connection,
    id: i64,
    name: &str,
    description: Option<&str>,
    image: Option<&str>,
    tags: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    update(&tx, id, name, description, image)?;
    tags::set_for_folder_tx(&tx, id, tags)?;
    tx.commit()
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<FolderRef>> {
    let mut stmt = conn.prepare("SELECT id, parent_id, name FROM folders ORDER BY name")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(FolderRef {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn chain(conn: &Connection, names: &[&str]) -> Vec<i64> {
        let mut parent = None;
        let mut ids = Vec::new();
        for name in names {
            let id = create(conn, name, parent).unwrap();
            ids.push(id);
            parent = Some(id);
        }
        ids
    }

    #[test]
    fn breadcrumbs_returns_root_to_leaf() {
        let conn = setup();
        let ids = chain(&conn, &["A", "B", "C"]);
        let crumbs = breadcrumbs(&conn, ids[2]).unwrap();
        let names: Vec<&str> = crumbs.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["A", "B", "C"]);
    }

    #[test]
    fn breadcrumbs_of_root_level_folder_has_one_crumb() {
        let conn = setup();
        let ids = chain(&conn, &["A"]);
        let crumbs = breadcrumbs(&conn, ids[0]).unwrap();
        assert_eq!(crumbs.len(), 1);
    }

    #[test]
    fn subtree_includes_root_and_all_descendants() {
        let conn = setup();
        let ids = chain(&conn, &["A", "B", "C"]);
        let subtree = subtree_ids(&conn, ids[0]).unwrap();
        assert_eq!(subtree.len(), 3);
        for id in ids {
            assert!(subtree.contains(&id));
        }
    }

    #[test]
    fn move_into_own_descendant_is_rejected() {
        let mut conn = setup();
        let ids = chain(&conn, &["A", "B", "C"]);
        let err = move_to(&mut conn, ids[0], Some(ids[2])).unwrap_err();
        assert!(matches!(err, MoveError::Cycle));
        let parent: Option<i64> = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1",
                params![ids[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(parent, None);
    }

    #[test]
    fn move_into_self_is_rejected() {
        let mut conn = setup();
        let ids = chain(&conn, &["A"]);
        let err = move_to(&mut conn, ids[0], Some(ids[0])).unwrap_err();
        assert!(matches!(err, MoveError::Cycle));
    }

    #[test]
    fn move_to_root_sets_null_parent() {
        let mut conn = setup();
        let ids = chain(&conn, &["A", "B"]);
        move_to(&mut conn, ids[1], None).unwrap();
        let parent: Option<i64> = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1",
                params![ids[1]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(parent, None);
    }

    #[test]
    fn deep_chain_terminates() {
        let conn = setup();
        let names: Vec<String> = (0..70).map(|i| format!("F{i}")).collect();
        let name_refs: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
        let ids = chain(&conn, &name_refs);
        let subtree = subtree_ids(&conn, ids[0]).unwrap();
        assert!(subtree.len() < 70, "depth cap did not stop the walk at 70 levels");
    }

    fn bookmark_in(conn: &Connection, folder_id: Option<i64>, url: &str) -> i64 {
        use crate::url_norm;
        let parsed = url_norm::parse(url).unwrap();
        bookmarks::create(conn, folder_id, "b", &parsed, None, None).unwrap()
    }

    #[test]
    fn contents_count_counts_full_depth() {
        let conn = setup();
        let ids = chain(&conn, &["A", "B", "C"]);
        bookmark_in(&conn, Some(ids[0]), "https://example.test/a");
        bookmark_in(&conn, Some(ids[1]), "https://example.test/b");
        bookmark_in(&conn, Some(ids[2]), "https://example.test/c1");
        bookmark_in(&conn, Some(ids[2]), "https://example.test/c2");

        let count = contents_count(&conn, ids[0]).unwrap();
        assert_eq!(count.bookmarks, 4);
        assert_eq!(count.folders, 2);
    }

    #[test]
    fn contents_count_of_empty_folder_is_zero() {
        let conn = setup();
        let ids = chain(&conn, &["A"]);
        let count = contents_count(&conn, ids[0]).unwrap();
        assert_eq!(count.bookmarks, 0);
        assert_eq!(count.folders, 0);
    }

    #[test]
    fn contents_count_of_nonexistent_id_is_zero_not_sql_error() {
        let conn = setup();
        let count = contents_count(&conn, 999_999).unwrap();
        assert_eq!(count.bookmarks, 0);
        assert_eq!(count.folders, 0);
    }

    #[test]
    fn delete_all_removes_subtree() {
        let mut conn = setup();
        let ids = chain(&conn, &["A", "B", "C"]);
        bookmark_in(&conn, Some(ids[2]), "https://example.test/deep");

        delete(&mut conn, ids[0], DeleteMode::All).unwrap();

        let folder_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))
            .unwrap();
        assert_eq!(folder_count, 0);
        let bookmark_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(bookmark_count, 0);
    }

    #[test]
    fn promote_moves_direct_children_to_parent() {
        let mut conn = setup();
        let a = create(&conn, "A", None).unwrap();
        let b = create(&conn, "B", Some(a)).unwrap();
        let c = create(&conn, "C", Some(b)).unwrap();
        bookmark_in(&conn, Some(b), "https://example.test/1");
        bookmark_in(&conn, Some(b), "https://example.test/2");
        bookmark_in(&conn, Some(b), "https://example.test/3");

        delete(&mut conn, b, DeleteMode::Promote).unwrap();

        let c_parent: Option<i64> = conn
            .query_row("SELECT parent_id FROM folders WHERE id = ?1", params![c], |row| row.get(0))
            .unwrap();
        assert_eq!(c_parent, Some(a));

        let moved_bookmarks = bookmarks::in_folder(&conn, Some(a)).unwrap();
        assert_eq!(moved_bookmarks.len(), 3);

        let b_exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM folders WHERE id = ?1", params![b], |row| row.get(0))
            .unwrap();
        assert_eq!(b_exists, 0);
    }

    #[test]
    fn promote_from_top_level_moves_to_root() {
        let mut conn = setup();
        let top = create(&conn, "Top", None).unwrap();
        let child = create(&conn, "Child", Some(top)).unwrap();
        bookmark_in(&conn, Some(top), "https://example.test/root-child");

        delete(&mut conn, top, DeleteMode::Promote).unwrap();

        let child_parent: Option<i64> = conn
            .query_row("SELECT parent_id FROM folders WHERE id = ?1", params![child], |row| row.get(0))
            .unwrap();
        assert_eq!(child_parent, None);

        let moved_bookmarks = bookmarks::in_folder(&conn, None).unwrap();
        assert_eq!(moved_bookmarks.len(), 1);
    }

    #[test]
    fn promote_does_not_lose_rows() {
        let mut conn = setup();
        let a = create(&conn, "A", None).unwrap();
        let b = create(&conn, "B", Some(a)).unwrap();
        bookmark_in(&conn, Some(b), "https://example.test/1");
        bookmark_in(&conn, Some(b), "https://example.test/2");
        bookmark_in(&conn, None, "https://example.test/root");

        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0))
            .unwrap();

        delete(&mut conn, b, DeleteMode::Promote).unwrap();

        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn update_with_tags_applies_fields_and_tags_together() {
        let mut conn = setup();
        let id = create(&conn, "A", None).unwrap();

        update_with_tags(
            &mut conn,
            id,
            "Renamed",
            Some("desc"),
            None,
            &["ui".to_string(), "design".to_string()],
        )
        .unwrap();

        let name: String = conn
            .query_row("SELECT name FROM folders WHERE id = ?1", params![id], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "Renamed");

        let tag_names = tags::for_folder(&conn, id).unwrap();
        assert_eq!(tag_names, vec!["design".to_string(), "ui".to_string()]);
    }
}
