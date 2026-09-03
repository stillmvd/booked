use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use magpie_core::backup;

use crate::db::{with_conn, Db};

fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("images"))
}

fn write_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = Path::new(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "Не удалось записать файл — проверьте место на диске".to_string())?;
    }
    let tmp = PathBuf::from(format!("{path}.tmp"));
    fs::write(&tmp, bytes).map_err(|_| "Не удалось записать файл — проверьте место на диске".to_string())?;
    fs::rename(&tmp, target).map_err(|_| {
        let _ = fs::remove_file(&tmp);
        "Не удалось записать файл — проверьте место на диске".to_string()
    })
}

#[tauri::command]
pub fn backup_export(app: AppHandle, db: State<Db>, path: String) -> Result<(), String> {
    let dir = images_dir(&app)?;
    let data = with_conn(&db, |conn| backup::build(conn, &dir))?;
    let json = serde_json::to_vec(&data).map_err(|_| "Не удалось подготовить файл выгрузки".to_string())?;
    write_atomic(&path, &json)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInspection {
    pub ok: bool,
    pub file_name: Option<String>,
    pub summary: Option<backup::BackupSummary>,
    pub current_folders: Option<i64>,
    pub current_bookmarks: Option<i64>,
    pub error: Option<String>,
}

impl ImportInspection {
    fn rejected(error: String) -> Self {
        ImportInspection {
            ok: false,
            file_name: None,
            summary: None,
            current_folders: None,
            current_bookmarks: None,
            error: Some(error),
        }
    }
}

#[tauri::command]
pub fn backup_inspect(
    db: State<Db>,
    path: String,
) -> Result<ImportInspection, String> {
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(ImportInspection::rejected("Не удалось прочитать файл".to_string())),
    };

    let parsed = match backup::parse(&bytes) {
        Ok(parsed) => parsed,
        Err(err) => return Ok(ImportInspection::rejected(err.to_string())),
    };

    let summary = backup::summary(&parsed);
    let (current_folders, current_bookmarks) = with_conn(&db, |conn| {
        let folders: i64 = conn.query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))?;
        let bookmarks: i64 = conn.query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0))?;
        Ok((folders, bookmarks))
    })?;

    let file_name = Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string());

    Ok(ImportInspection {
        ok: true,
        file_name,
        summary: Some(summary),
        current_folders: Some(current_folders),
        current_bookmarks: Some(current_bookmarks),
        error: None,
    })
}

#[tauri::command]
pub fn backup_import(
    app: AppHandle,
    db: State<Db>,
    path: String,
    mode: backup::ImportMode,
) -> Result<backup::Applied, String> {
    let bytes = fs::read(&path).map_err(|_| "Не удалось прочитать файл".to_string())?;
    let parsed = backup::parse(&bytes).map_err(|e| e.to_string())?;
    let dir = images_dir(&app)?;
    let mut guard = db.0.lock().map_err(|e| e.to_string())?;
    match &mut *guard {
        Ok(conn) => backup::apply(conn, &parsed, mode, &dir).map_err(|e| e.to_string()),
        Err(failure) => Err(failure.message.clone()),
    }
}
