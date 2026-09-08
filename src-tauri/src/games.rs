use std::path::Path;
use std::sync::mpsc;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use booked_core::games::{self, Game, ScannedFolder};
use booked_core::settings;

use crate::db::{with_conn, with_conn_mut, Db};

pub const GAMES_ROOT_KEY: &str = "games_root";
pub const GAMES_CHANGED_EVENT: &str = "games:changed";
const SETTLE: Duration = Duration::from_millis(500);

pub struct GamesWatch(pub Mutex<Option<RecommendedWatcher>>);

impl Default for GamesWatch {
    fn default() -> Self {
        GamesWatch(Mutex::new(None))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamesLibrary {
    pub root: Option<String>,
    pub root_available: bool,
    pub games: Vec<Game>,
}

fn stored_root(conn: &rusqlite::Connection) -> rusqlite::Result<Option<String>> {
    settings::value(conn, GAMES_ROOT_KEY)
}

pub enum RootState {
    Unset,
    Missing,
    Unreadable,
    Listed(Vec<ScannedFolder>),
}

pub fn scan_root(root: &Path) -> RootState {
    if !root.is_dir() {
        return RootState::Missing;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return RootState::Unreadable;
    };
    let mut folders = Vec::new();
    for entry in entries.flatten() {
        if !entry.metadata().map(|m| m.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        folders.push(ScannedFolder {
            name,
            path: entry.path().to_string_lossy().to_string(),
            size_bytes: None,
        });
    }
    RootState::Listed(folders)
}

fn root_state(root: Option<&str>) -> RootState {
    match root {
        Some(root) if !root.trim().is_empty() => scan_root(Path::new(root)),
        _ => RootState::Unset,
    }
}

pub fn folder_size(root: &Path) -> i64 {
    let mut total: i64 = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                stack.push(entry.path());
            } else if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len() as i64);
            }
        }
    }
    total
}

fn sync_state(db: &State<Db>, state: &RootState) -> Result<(), String> {
    let RootState::Listed(folders) = state else {
        return Ok(());
    };
    with_conn_mut(db, |conn| games::sync(conn, folders))?;
    Ok(())
}

fn library_now(db: &State<Db>) -> Result<GamesLibrary, String> {
    let root = with_conn(db, stored_root)?;
    let state = root_state(root.as_deref());
    sync_state(db, &state)?;
    let games = with_conn(db, games::list)?;
    Ok(GamesLibrary {
        root,
        root_available: matches!(state, RootState::Listed(_)),
        games,
    })
}

#[tauri::command]
pub fn games_library(db: State<Db>) -> Result<GamesLibrary, String> {
    library_now(&db)
}

#[tauri::command]
pub fn games_rescan(app: AppHandle, db: State<Db>) -> Result<GamesLibrary, String> {
    let library = library_now(&db)?;
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(library)
}

#[tauri::command]
pub fn games_root_set(app: AppHandle, db: State<Db>, path: String) -> Result<GamesLibrary, String> {
    let trimmed = path.trim().to_string();
    if !trimmed.is_empty() && !Path::new(&trimmed).is_dir() {
        return Err("Такой папки нет — выберите другую.".to_string());
    }

    let previous = with_conn(&db, stored_root)?;
    let switch = app.state::<GamesWatch>();
    let guard = lock_watch(&switch);
    with_conn(&db, |conn| settings::write(conn, GAMES_ROOT_KEY, &trimmed))?;
    let next = if trimmed.is_empty() { None } else { Some(trimmed.as_str()) };
    start_watch(&app, guard, next);

    match library_now(&db) {
        Ok(library) => Ok(library),
        Err(err) => {
            let restore = previous.clone().unwrap_or_default();
            let _ = with_conn(&db, |conn| settings::write(conn, GAMES_ROOT_KEY, &restore));
            let switch = app.state::<GamesWatch>();
            let guard = lock_watch(&switch);
            start_watch(&app, guard, previous.as_deref());
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn games_measure(app: AppHandle, id: i64) -> Result<Option<i64>, String> {
    let folder = {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::get(conn, id))?.and_then(|g| g.folder_path)
    };
    let Some(folder) = folder else {
        return Ok(None);
    };

    let size = tauri::async_runtime::spawn_blocking(move || folder_size(Path::new(&folder)))
        .await
        .map_err(|_| "Не удалось посчитать размер папки.".to_string())?;

    let db = app.state::<Db>();
    with_conn(&db, |conn| games::set_size(conn, id, size))?;
    Ok(Some(size))
}

#[tauri::command]
pub fn game_set_title(db: State<Db>, id: i64, title: String) -> Result<(), String> {
    with_conn(&db, |conn| games::set_title(conn, id, &title))
}

#[tauri::command]
pub fn game_set_version(db: State<Db>, id: i64, version: Option<String>) -> Result<(), String> {
    with_conn(&db, |conn| games::set_version(conn, id, version.as_deref()))
}

#[tauri::command]
pub fn game_set_status(db: State<Db>, id: i64, status: String) -> Result<(), String> {
    with_conn(&db, |conn| games::set_status(conn, id, &status))
}

#[tauri::command]
pub fn game_set_rating(db: State<Db>, id: i64, rating: i64) -> Result<(), String> {
    with_conn(&db, |conn| games::set_rating(conn, id, rating))
}

#[tauri::command]
pub fn game_set_tags(db: State<Db>, id: i64, tags: Vec<String>) -> Result<(), String> {
    with_conn_mut(&db, |conn| games::set_tags(conn, id, &tags))
}

#[tauri::command]
pub fn game_forget(db: State<Db>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| games::forget(conn, id))
}

fn lock_watch<'a>(state: &'a State<GamesWatch>) -> MutexGuard<'a, Option<RecommendedWatcher>> {
    match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn start_watch(
    app: &AppHandle,
    mut guard: MutexGuard<'_, Option<RecommendedWatcher>>,
    root: Option<&str>,
) {
    *guard = None;

    let Some(root) = root.filter(|r| Path::new(r).is_dir()) else {
        return;
    };

    let (tx, rx) = mpsc::channel();
    let handler = move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    };
    let Ok(mut watcher) = notify::recommended_watcher(handler) else {
        return;
    };
    if watcher.watch(Path::new(root), RecursiveMode::NonRecursive).is_err() {
        return;
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(SETTLE).is_ok() {}
            let db = handle.state::<Db>();
            let root = match with_conn(&db, stored_root) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if sync_state(&db, &root_state(root.as_deref())).is_ok() {
                let _ = handle.emit(GAMES_CHANGED_EVENT, ());
            }
        }
    });

    *guard = Some(watcher);
}

pub fn setup(app: &AppHandle) {
    app.manage(GamesWatch::default());
    let db = app.state::<Db>();
    let root = with_conn(&db, stored_root).ok().flatten();
    let _ = sync_state(&db, &root_state(root.as_deref()));
    let watch = app.state::<GamesWatch>();
    let guard = lock_watch(&watch);
    start_watch(app, guard, root.as_deref());
}
