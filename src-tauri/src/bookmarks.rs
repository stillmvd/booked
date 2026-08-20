use tauri::State;
use trove_core::bookmarks::{self, DuplicateHit};
use trove_core::images;
use trove_core::tags;
use trove_core::url_norm;

use crate::db::{with_conn, with_conn_mut, Db};

#[tauri::command]
pub fn bookmark_open(db: State<Db>, id: i64) -> Result<(), String> {
    let url = with_conn(&db, |conn| Ok(bookmarks::url_for_open(conn, id)))??;
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bookmark_find_duplicate(db: State<Db>, url: String) -> Result<Option<DuplicateHit>, String> {
    let normalized = match url_norm::parse(&url) {
        Ok(parsed) => parsed.normalized,
        Err(_) => return Ok(None),
    };
    with_conn(&db, |conn| bookmarks::find_by_normalized(conn, &normalized))
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
    let title = if title.trim().is_empty() { bookmarks::host_of(&parsed) } else { title };
    with_conn(&db, |conn| {
        bookmarks::create(conn, folder_id, &title, &parsed, description.as_deref(), image.as_deref())
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
    let title = if title.trim().is_empty() { bookmarks::host_of(&parsed) } else { title };
    with_conn(&db, |conn| {
        bookmarks::update(conn, id, folder_id, &title, &parsed, description.as_deref(), image.as_deref())
    })
}

#[tauri::command]
pub fn bookmark_set_tags(db: State<Db>, id: i64, tags: Vec<String>) -> Result<(), String> {
    with_conn_mut(&db, |conn| tags::set_for_bookmark(conn, id, &tags))
}

#[tauri::command]
pub fn bookmark_delete(db: State<Db>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| bookmarks::delete(conn, id))
}
