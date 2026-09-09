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
pub const GAMES_CHECK_KEY: &str = "games_last_check";
const DAY_SECONDS: i64 = 24 * 60 * 60;
const SETTLE: Duration = Duration::from_millis(500);
const POLITE_GAP: Duration = Duration::from_millis(1200);

pub struct GamesWatch(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Default)]
pub struct GamesCheck(pub std::sync::atomic::AtomicBool);

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

fn guard_inside_root(db: &State<Db>, folder: &Path) -> Result<(), String> {
    let root = with_conn(db, stored_root)?
        .ok_or_else(|| "Папка с играми не выбрана.".to_string())?;
    if !is_within(Path::new(&root), folder) {
        return Err("Эта папка лежит вне папки с играми.".to_string());
    }
    Ok(())
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
pub fn game_set_image(db: State<Db>, id: i64, file: Option<String>) -> Result<(), String> {
    with_conn(&db, |conn| games::set_image(conn, id, file.as_deref()))
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

fn exe_inside(folder: &Path, relative: &str) -> Option<std::path::PathBuf> {
    let full = folder.join(relative);
    (full.is_file() && is_within(folder, &full)).then_some(full)
}

#[tauri::command]
pub fn game_launch(db: State<Db>, id: i64) -> Result<(), String> {
    let (game, folder) = game_folder(&db, id)?;
    guard_inside_root(&db, &folder)?;

    let saved = game
        .exe_path
        .clone()
        .and_then(|rel| exe_inside(&folder, &rel).map(|full| (rel, full)));

    let (chosen, exe) = match saved {
        Some(pair) => pair,
        None => {
            let picked = games::pick_exe(&exe_candidates(&folder), &game.base_name)
                .and_then(|rel| exe_inside(&folder, &rel).map(|full| (rel, full)))
                .ok_or_else(|| "Не нашёл, что запускать — выберите файл вручную.".to_string())?;
            with_conn(&db, |conn| games::set_exe(conn, id, &picked.0, false))?;
            picked
        }
    };
    let _ = chosen;

    std::process::Command::new(&exe)
        .current_dir(&folder)
        .spawn()
        .map_err(|_| "Не удалось запустить игру.".to_string())?;

    with_conn(&db, |conn| games::mark_launched(conn, id))
}

#[tauri::command]
pub fn game_delete_folder(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let (_, folder) = game_folder(&db, id)?;
    guard_inside_root(&db, &folder)
        .map_err(|_| "Эта папка лежит вне папки с играми — удалять её отсюда нельзя.".to_string())?;

    std::fs::remove_dir_all(&folder)
        .map_err(|_| "Игра запущена или файлы заняты — закройте её и попробуйте снова.".to_string())?;

    with_conn(&db, |conn| games::detach_folder(conn, id))?;
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(())
}

pub fn devlog_url(page: &str) -> Option<String> {
    let mut parsed = url::Url::parse(page.trim()).ok()?;
    parsed.set_query(None);
    parsed.set_fragment(None);
    let path = parsed.path().trim_end_matches('/').to_string();
    parsed.set_path(&format!("{path}/devlog.rss"));
    Some(parsed.to_string())
}

async fn read_site_version(
    fetcher: &crate::net::Fetcher,
    source: games::Source,
    url: &str,
) -> Result<Option<String>, String> {
    let page = crate::net::fetch_document(fetcher, url)
        .await
        .map_err(|_| "Нет сети или сайт недоступен.".to_string())?;
    let html = booked_core::meta::decode_html(&page.body, &page.content_type);

    match source {
        games::Source::F95 => Ok(games::f95_version_from_html(&html)),
        games::Source::Itch => {
            if let Some(stamp) = games::itch_updated_from_html(&html) {
                return Ok(Some(stamp));
            }
            let devlog = devlog_url(url).ok_or_else(|| "Не удалось разобрать страницу.".to_string())?;
            let feed = crate::net::fetch_document(fetcher, &devlog)
                .await
                .map_err(|_| "Не удалось разобрать страницу.".to_string())?;
            let text = booked_core::meta::decode_html(&feed.body, &feed.content_type);
            Ok(games::itch_updated_from_devlog(&text))
        }
    }
}

async fn grab_cover(app: &AppHandle, fetcher: &crate::net::Fetcher, url: &str) -> Option<String> {
    let page = crate::net::fetch_page(fetcher, url).await.ok()?;
    let html = booked_core::meta::decode_html(&page.body, &page.content_type);
    let base = url::Url::parse(&page.final_url).ok()?;
    let meta = booked_core::meta::extract(&html, &base);
    let image = meta.image?;
    let fetched = crate::net::fetch_image(fetcher, image.as_str()).await.ok()?;
    let dir = app.path().app_local_data_dir().ok()?.join("images");
    booked_core::images::import_bytes(&dir, &fetched.bytes).ok()
}

#[tauri::command]
pub async fn game_set_page(app: AppHandle, id: i64, url: Option<String>) -> Result<(), String> {
    {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::set_page(conn, id, url.as_deref()))?;
    }

    let Some(url) = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty()) else {
        return Ok(());
    };
    let Some(source) = games::source_from_url(&url) else {
        return Ok(());
    };

    let fetcher = app.state::<crate::net::Fetcher>();
    let version = read_site_version(&fetcher, source, &url).await?;
    {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::record_check(conn, id, version.as_deref(), true))?;
    }

    let has_cover = {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::get(conn, id))?.and_then(|g| g.image).is_some()
    };
    if !has_cover {
        if let Some(file) = grab_cover(&app, &fetcher, &url).await {
            let db = app.state::<Db>();
            with_conn(&db, |conn| games::set_image(conn, id, Some(&file)))?;
        }
    }

    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn game_skip_version(db: State<Db>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| games::skip_current_version(conn, id))
}

#[tauri::command]
pub fn game_open_page(db: State<Db>, id: i64) -> Result<(), String> {
    let page = with_conn(&db, |conn| games::get(conn, id))?
        .and_then(|game| game.page_url)
        .ok_or_else(|| "У этой игры не указана страница.".to_string())?;
    let safe = booked_core::browsers::is_launchable_url(&page)
        .map_err(|_| "Ссылка на страницу игры не открывается.".to_string())?;
    tauri_plugin_opener::open_url(&safe, None::<&str>)
        .map_err(|_| "Не удалось открыть страницу в браузере.".to_string())
}

#[tauri::command]
pub async fn games_check(app: AppHandle, force: bool) -> Result<GamesLibrary, String> {
    let running = app.state::<GamesCheck>();
    if running.0.swap(true, std::sync::atomic::Ordering::SeqCst) {
        let db = app.state::<Db>();
        return library_now(&db);
    }
    let outcome = run_check(&app, force).await;
    app.state::<GamesCheck>()
        .0
        .store(false, std::sync::atomic::Ordering::SeqCst);
    outcome
}

async fn run_check(app: &AppHandle, force: bool) -> Result<GamesLibrary, String> {
    let due = {
        let db = app.state::<Db>();
        let last: Option<i64> = with_conn(&db, |conn| settings::value(conn, GAMES_CHECK_KEY))?
            .and_then(|v| v.parse().ok());
        let now = now_stamp();
        force || last.map(|t| now - t >= DAY_SECONDS).unwrap_or(true)
    };
    if !due {
        let db = app.state::<Db>();
        return library_now(&db);
    }

    let queue = {
        let db = app.state::<Db>();
        with_conn(&db, games::checkable)?
    };

    let mut checked_any = false;
    for (index, (id, source, url)) in queue.iter().enumerate() {
        let Some(source) = games::source_from_str(source) else {
            continue;
        };
        if index > 0 {
            tauri::async_runtime::spawn_blocking(|| std::thread::sleep(POLITE_GAP))
                .await
                .ok();
        }
        let fetcher = app.state::<crate::net::Fetcher>();
        match read_site_version(&fetcher, source, url).await {
            Ok(version) => {
                let db = app.state::<Db>();
                with_conn(&db, |conn| games::record_check(conn, *id, version.as_deref(), false))?;
                checked_any = true;
            }
            Err(_) => continue,
        }
    }

    if checked_any {
        let db = app.state::<Db>();
        with_conn(&db, |conn| {
            settings::write(conn, GAMES_CHECK_KEY, &now_stamp().to_string())
        })?;
    }

    let db = app.state::<Db>();
    let library = library_now(&db)?;
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(library)
}

fn now_stamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
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
    app.manage(GamesCheck::default());
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
    fn exe_outside_the_game_folder_is_rejected() {
        let root = temp_root("exe-escape");
        let game = root.join("Game-1.0-pc");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(root.join("evil.exe"), vec![0u8; 10]).unwrap();
        std::fs::write(game.join("Game.exe"), vec![0u8; 10]).unwrap();

        assert!(exe_inside(&game, "Game.exe").is_some());
        assert!(exe_inside(&game, "../evil.exe").is_none());
        assert!(exe_inside(&game, "..\\evil.exe").is_none());
        assert!(exe_inside(&game, "C:\\Windows\\System32\\cmd.exe").is_none());
        assert!(exe_inside(&game, "нет-такого.exe").is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn devlog_address_survives_query_and_anchor() {
        assert_eq!(
            devlog_url("https://zanithone.itch.io/a-house-in-the-rift").as_deref(),
            Some("https://zanithone.itch.io/a-house-in-the-rift/devlog.rss")
        );
        assert_eq!(
            devlog_url("https://zanithone.itch.io/a-house-in-the-rift/").as_deref(),
            Some("https://zanithone.itch.io/a-house-in-the-rift/devlog.rss")
        );
        assert_eq!(
            devlog_url("https://zanithone.itch.io/a-house-in-the-rift?ref=abc#comments").as_deref(),
            Some("https://zanithone.itch.io/a-house-in-the-rift/devlog.rss")
        );
        assert_eq!(devlog_url("не ссылка"), None);
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
