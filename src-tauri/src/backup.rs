use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use booked_core::{auto_backup, backup, settings};

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

const AUTO_BACKUP_GAP: Duration = Duration::from_secs(6 * 60 * 60);

fn auto_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(|e| e.to_string())?.join("Booked"))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn auto_backup_if_due(app: &AppHandle) -> Result<(), String> {
    let db = app.state::<Db>();
    let dest = auto_dir(app)?;
    let now = now_secs();
    let Some(snapshot) = with_conn(&db, |conn| {
        let last = settings::value(conn, auto_backup::LAST_KEY)?.and_then(|v| v.parse().ok());
        Ok(auto_backup::due(last, now).then(|| auto_backup::snapshot(conn, &dest)))
    })?
    else {
        return Ok(());
    };
    snapshot.map_err(|e| e.to_string())?;
    auto_backup::copy_missing(&images_dir(app)?, &dest.join("images")).map_err(|e| e.to_string())?;
    auto_backup::prune(&dest, auto_backup::KEEP).map_err(|e| e.to_string())?;
    with_conn(&db, |conn| settings::write(conn, auto_backup::LAST_KEY, &now.to_string()))
}

pub fn start_auto_backup(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        if let Err(err) = auto_backup_if_due(&app) {
            eprintln!("auto backup: {err}");
        }
        std::thread::sleep(AUTO_BACKUP_GAP);
    });
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupInfo {
    pub dir: String,
    pub last_at: Option<i64>,
}

#[tauri::command]
pub fn backup_auto_info(app: AppHandle, db: State<Db>) -> Result<AutoBackupInfo, String> {
    let last_at = with_conn(&db, |conn| settings::value(conn, auto_backup::LAST_KEY))?
        .and_then(|v| v.parse().ok());
    Ok(AutoBackupInfo { dir: auto_dir(&app)?.display().to_string(), last_at })
}

#[tauri::command]
pub fn backup_auto_reveal(app: AppHandle) -> Result<(), String> {
    let dir = auto_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|_| "Не удалось открыть папку с копиями".to_string())?;
    tauri_plugin_opener::open_path(dir, None::<&str>).map_err(|_| "Не удалось открыть папку с копиями".to_string())
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
