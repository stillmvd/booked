use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::{with_conn, Db};

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
