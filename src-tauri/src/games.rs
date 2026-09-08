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

pub fn exe_candidates(root: &Path) -> Vec<games::ExeCandidate> {
    let mut found = Vec::new();
    collect_exe(root, root, 0, &mut found);
    found
}

fn collect_exe(root: &Path, dir: &Path, depth: u8, out: &mut Vec<games::ExeCandidate>) {
    if depth > 2 || out.len() > 400 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            collect_exe(root, &path, depth + 1, out);
            continue;
        }
        if !path.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false) {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap_or(&path);
        out.push(games::ExeCandidate {
            path: relative.to_string_lossy().to_string(),
            size: entry.metadata().map(|m| m.len()).unwrap_or(0),
            depth,
        });
    }
}

pub fn is_within(root: &Path, candidate: &Path) -> bool {
    let (Ok(root), Ok(candidate)) = (root.canonicalize(), candidate.canonicalize()) else {
        return false;
    };
    candidate != root && candidate.starts_with(&root)
}

fn game_folder(db: &State<Db>, id: i64) -> Result<(games::Game, std::path::PathBuf), String> {
    let game = with_conn(db, |conn| games::get(conn, id))?
        .ok_or_else(|| "Игра не найдена.".to_string())?;
    let folder = game
        .folder_path
        .clone()
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .ok_or_else(|| "Папки этой игры нет на диске.".to_string())?;
    Ok((game, folder))
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

#[tauri::command]
pub fn game_exe_list(db: State<Db>, id: i64) -> Result<Vec<String>, String> {
    let (_, folder) = game_folder(&db, id)?;
    let mut names: Vec<String> = exe_candidates(&folder).into_iter().map(|c| c.path).collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn game_set_exe(db: State<Db>, id: i64, path: String) -> Result<(), String> {
    let (_, folder) = game_folder(&db, id)?;
    let full = folder.join(&path);
    if !is_within(&folder, &full) || !full.is_file() {
        return Err("Такого файла в папке игры нет.".to_string());
    }
    with_conn(&db, |conn| games::set_exe(conn, id, &path, true))
}

#[tauri::command]
pub fn game_launch(db: State<Db>, id: i64) -> Result<(), String> {
    let (game, folder) = game_folder(&db, id)?;

    let saved = game
        .exe_path
        .clone()
        .filter(|rel| folder.join(rel).is_file() && is_within(&folder, &folder.join(rel)));

    let chosen = match saved {
        Some(rel) => rel,
        None => {
            let picked = games::pick_exe(&exe_candidates(&folder), &game.base_name)
                .ok_or_else(|| "Не нашёл, что запускать — выберите файл вручную.".to_string())?;
            with_conn(&db, |conn| games::set_exe(conn, id, &picked, false))?;
            picked
        }
    };

    let exe = folder.join(&chosen);
    std::process::Command::new(&exe)
        .current_dir(&folder)
        .spawn()
        .map_err(|_| "Не удалось запустить игру.".to_string())?;

    with_conn(&db, |conn| games::mark_launched(conn, id))
}

#[tauri::command]
pub fn game_delete_folder(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let (_, folder) = game_folder(&db, id)?;
    let root = with_conn(&db, stored_root)?
        .ok_or_else(|| "Папка с играми не выбрана.".to_string())?;

    if !is_within(Path::new(&root), &folder) {
        return Err("Эта папка лежит вне папки с играми — удалять её отсюда нельзя.".to_string());
    }

    std::fs::remove_dir_all(&folder)
        .map_err(|_| "Игра запущена или файлы заняты — закройте её и попробуйте снова.".to_string())?;

    with_conn(&db, |conn| games::detach_folder(conn, id))?;
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("booked-games-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_tells_empty_folder_from_unreadable_one() {
        let root = temp_root("scan");
        assert!(matches!(scan_root(&root), RootState::Listed(ref f) if f.is_empty()));

        std::fs::create_dir_all(root.join("PathOfDesire-0.5.2-pc")).unwrap();
        std::fs::write(root.join("readme.txt"), b"x").unwrap();
        let RootState::Listed(found) = scan_root(&root) else {
            panic!("ожидали список папок");
        };
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "PathOfDesire-0.5.2-pc");

        assert!(matches!(scan_root(&root.join("нет-такой")), RootState::Missing));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn exe_list_reaches_nested_files_and_keeps_relative_paths() {
        let root = temp_root("exe");
        let game = root.join("PathOfDesire-0.5.2-pc");
        std::fs::create_dir_all(game.join("data")).unwrap();
        std::fs::write(game.join("unins000.exe"), vec![0u8; 2048]).unwrap();
        std::fs::write(game.join("PathOfDesire.exe"), vec![0u8; 512]).unwrap();
        std::fs::write(game.join("data").join("helper.exe"), vec![0u8; 64]).unwrap();

        let candidates = exe_candidates(&game);
        assert_eq!(candidates.len(), 3);
        let picked = booked_core::games::pick_exe(&candidates, "pathofdesire");
        assert_eq!(picked.as_deref(), Some("PathOfDesire.exe"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn folder_outside_the_games_root_is_not_deletable() {
        let root = temp_root("within");
        let inside = root.join("Game-1.0-pc");
        std::fs::create_dir_all(&inside).unwrap();
        let outside = temp_root("within-outside");

        assert!(is_within(&root, &inside));
        assert!(!is_within(&root, &outside));
        assert!(!is_within(&root, &root));
        assert!(!is_within(&root, &root.join("..")));

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn folder_size_counts_nested_files() {
        let root = temp_root("size");
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("game.exe"), vec![0u8; 1000]).unwrap();
        std::fs::write(root.join("assets").join("pack.bin"), vec![0u8; 2000]).unwrap();
        assert_eq!(folder_size(&root), 3000);
        let _ = std::fs::remove_dir_all(&root);
    }
}
