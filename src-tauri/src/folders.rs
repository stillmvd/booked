use tauri::State;
use booked_core::folders::{self, ContentsCount, Crumb, DeleteMode, FolderContents, FolderRef};
use booked_core::images;

use crate::db::{with_conn, with_conn_mut, Db};

#[tauri::command]
pub fn folder_create(db: State<Db>, name: String, parent_id: Option<i64>) -> Result<i64, String> {
    with_conn(&db, |conn| folders::create(conn, &name, parent_id))
}

#[tauri::command]
pub fn folder_children(
    db: State<Db>,
    parent_id: Option<i64>,
) -> Result<FolderContents, String> {
    with_conn(&db, |conn| folders::children(conn, parent_id))
}

#[tauri::command]
pub fn folder_breadcrumbs(db: State<Db>, id: i64) -> Result<Vec<Crumb>, String> {
    with_conn(&db, |conn| folders::breadcrumbs(conn, id))
}

#[tauri::command]
pub fn folder_move(db: State<Db>, id: i64, new_parent: Option<i64>) -> Result<(), String> {
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    match &mut *guard {
        Ok(conn) => folders::move_to(conn, id, new_parent).map_err(|e| e.to_string()),
        Err(failure) => Err(failure.message.clone()),
    }
}

#[tauri::command]
pub fn folder_update(
    db: State<Db>,
    id: i64,
    name: String,
    description: Option<String>,
    image: Option<String>,
    tags: Vec<String>,
) -> Result<(), String> {
    if let Some(filename) = &image {
        if !images::is_valid_image_filename(filename) {
            return Err("недопустимое имя файла картинки".into());
        }
    }
    with_conn_mut(&db, |conn| {
        folders::update_with_tags(conn, id, &name, description.as_deref(), image.as_deref(), &tags)
    })
}

#[tauri::command]
pub fn folder_list_all(db: State<Db>) -> Result<Vec<FolderRef>, String> {
    with_conn(&db, folders::list_all)
}

#[tauri::command]
pub fn folder_contents_count(db: State<Db>, id: i64) -> Result<ContentsCount, String> {
    with_conn(&db, |conn| folders::contents_count(conn, id))
}

#[tauri::command]
pub fn folder_delete(db: State<Db>, id: i64, mode: DeleteMode) -> Result<(), String> {
    with_conn_mut(&db, |conn| folders::delete(conn, id, mode))
}
