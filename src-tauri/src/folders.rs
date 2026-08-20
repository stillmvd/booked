use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::{with_conn, Db};

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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderContents {
    pub folders: Vec<Folder>,
    pub bookmarks: Vec<Bookmark>,
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
    let folders = folder_stmt
        .query_map(params![parent_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                image: row.get(4)?,
                sort: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut bookmark_stmt = conn.prepare(
        "SELECT id, folder_id, title, url, url_normalized, description, image, sort \
         FROM bookmarks WHERE folder_id IS ?1 ORDER BY sort, id",
    )?;
    let bookmarks = bookmark_stmt
        .query_map(params![parent_id], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                title: row.get(2)?,
                url: row.get(3)?,
                url_normalized: row.get(4)?,
                description: row.get(5)?,
                image: row.get(6)?,
                sort: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

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

#[tauri::command]
pub fn folder_create(db: State<Db>, name: String, parent_id: Option<i64>) -> Result<i64, String> {
    with_conn(&db, |conn| create(conn, &name, parent_id))
}

#[tauri::command]
pub fn folder_children(
    db: State<Db>,
    parent_id: Option<i64>,
) -> Result<FolderContents, String> {
    with_conn(&db, |conn| children(conn, parent_id))
}

#[tauri::command]
pub fn folder_breadcrumbs(db: State<Db>, id: i64) -> Result<Vec<Crumb>, String> {
    with_conn(&db, |conn| breadcrumbs(conn, id))
}

#[tauri::command]
pub fn folder_move(db: State<Db>, id: i64, new_parent: Option<i64>) -> Result<(), String> {
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    match &mut *guard {
        Ok(conn) => move_to(conn, id, new_parent).map_err(|e| e.to_string()),
        Err(failure) => Err(failure.message.clone()),
    }
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
}
