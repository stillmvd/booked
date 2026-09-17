use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use booked_core::game_merge::{self, KeptCandidate, MatchReasons, SaveFile, VersionGroup};
use booked_core::games::{self, Game, ScannedFolder};
use booked_core::settings;

use crate::db::{with_conn, with_conn_mut, Db};
use crate::recycle::{self, Recycle};

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
    pub versions: Vec<VersionGroup>,
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

pub fn top_level_names(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect()
}

pub fn is_within(root: &Path, candidate: &Path) -> bool {
    let (Ok(root), Ok(candidate)) = (root.canonicalize(), candidate.canonicalize()) else {
        return false;
    };
    candidate != root && candidate.starts_with(&root)
}

fn game_folder(db: &Db, id: i64) -> Result<(games::Game, std::path::PathBuf), String> {
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

fn guard_inside_root(db: &Db, folder: &Path) -> Result<(), String> {
    let root = with_conn(db, stored_root)?
        .ok_or_else(|| "Папка с играми не выбрана.".to_string())?;
    if !is_within(Path::new(&root), folder) {
        return Err("Эта папка лежит вне папки с играми.".to_string());
    }
    Ok(())
}

fn sync_state(db: &Db, state: &RootState) -> Result<(), String> {
    let RootState::Listed(folders) = state else {
        return Ok(());
    };
    with_conn_mut(db, |conn| games::sync(conn, folders))?;

    let targets = with_conn(db, games::games_without_manual_exe)?;
    for (id, base_name, folder_path) in targets {
        let candidates = exe_candidates(Path::new(&folder_path));
        if let Some(path) = games::pick_exe(&candidates, &base_name) {
            with_conn(db, |conn| games::set_exe_auto(conn, id, &path))?;
        }
    }

    let unknown = with_conn(db, games::games_without_engine)?;
    for (id, folder_path) in unknown {
        let names = top_level_names(Path::new(&folder_path));
        if names.is_empty() {
            continue;
        }
        let engine = games::engine_from_folder(&names).unwrap_or(games::ENGINE_UNKNOWN);
        with_conn(db, |conn| games::set_engine_guess(conn, id, engine))?;
    }
    Ok(())
}

fn library_now(db: &Db) -> Result<GamesLibrary, String> {
    let root = with_conn(db, stored_root)?;
    let state = root_state(root.as_deref());
    sync_state(db, &state)?;
    let games = with_conn(db, games::list)?;
    let versions = with_conn(db, game_merge::groups)?;
    Ok(GamesLibrary {
        root,
        root_available: matches!(state, RootState::Listed(_)),
        games,
        versions,
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
        Ok(library) => {
            let _ = app.emit(GAMES_CHANGED_EVENT, ());
            Ok(library)
        }
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
pub fn game_set_cover_pos(db: State<Db>, id: i64, x: f64, y: f64) -> Result<(), String> {
    with_conn(&db, |conn| games::set_cover_pos(conn, id, x, y))
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

pub fn relative_exe(folder: &Path, path: &str) -> Option<String> {
    let candidate = Path::new(path);
    let full = if candidate.is_absolute() { candidate.to_path_buf() } else { folder.join(candidate) };
    if !full.is_file() || !is_within(folder, &full) {
        return None;
    }
    let (root, inside) = (folder.canonicalize().ok()?, full.canonicalize().ok()?);
    let relative = inside.strip_prefix(&root).ok()?;
    Some(relative.to_string_lossy().to_string())
}

#[tauri::command]
pub fn game_set_exe(db: State<Db>, id: i64, path: String) -> Result<(), String> {
    let (_, folder) = game_folder(&db, id)?;
    let relative =
        relative_exe(&folder, &path).ok_or_else(|| "Такого файла в папке игры нет.".to_string())?;
    with_conn(&db, |conn| games::set_exe(conn, id, &relative, true))
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeFolder {
    pub id: i64,
    pub size_bytes: i64,
    pub modified: Option<i64>,
    pub saves: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    pub ids: Vec<i64>,
    pub reasons: Option<MatchReasons>,
    pub kept_id: Option<i64>,
    pub folders: Vec<MergeFolder>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MergeOutcome {
    Done { id: i64 },
    NeedsPermanent { folder: String, path: String, bytes: i64 },
}

fn millis(meta: &std::fs::Metadata) -> Option<i64> {
    let stamp = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(stamp.as_millis()).ok()
}

fn relative_slash(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

pub fn save_files(root: &Path) -> Vec<SaveFile> {
    let mut found = Vec::new();
    let mut stack: Vec<PathBuf> = game_merge::SAVE_DIRS
        .iter()
        .map(|dir| root.join(dir))
        .filter(|dir| dir.is_dir())
        .collect();
    let visit = |path: PathBuf, meta: std::fs::Metadata, found: &mut Vec<SaveFile>| {
        if let Some(rel) = relative_slash(root, &path).filter(|rel| game_merge::is_save_path(rel)) {
            if !found.iter().any(|known: &SaveFile| known.rel == rel) {
                found.push(SaveFile { rel, modified: millis(&meta).unwrap_or(0) });
            }
        }
    };
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if let (Ok(kind), Ok(meta)) = (entry.file_type(), entry.metadata()) {
                if kind.is_file() {
                    visit(entry.path(), meta, &mut found);
                }
            }
        }
    }
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                stack.push(entry.path());
            } else if kind.is_file() {
                if let Ok(meta) = entry.metadata() {
                    visit(entry.path(), meta, &mut found);
                }
            }
        }
    }
    found
}

fn size_and_change(root: &Path) -> (i64, Option<i64>) {
    let mut total: i64 = 0;
    let mut latest: Option<i64> = None;
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
                if let Some(stamp) = millis(&meta) {
                    latest = Some(latest.map_or(stamp, |known| known.max(stamp)));
                }
            }
        }
    }
    (total, latest)
}

fn folder_label(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| folder.to_string_lossy().to_string())
}

fn busy_text(folder: &Path) -> String {
    format!("Папка «{}» занята — закройте игру и повторите.", folder_label(folder))
}

pub fn merge_preview(db: &Db, ids: &[i64]) -> Result<MergePreview, String> {
    let cards = with_conn(db, |conn| game_merge::merge_cards(conn, ids))?;
    if cards.len() < 2 {
        return Err("Эти карточки уже объединены или убраны из списка.".to_string());
    }
    let ordered: Vec<i64> = cards.iter().map(|card| card.game.id).collect();
    let reasons = with_conn(db, |conn| game_merge::reasons_for(conn, &ordered))?;

    let mut folders = Vec::new();
    let mut candidates = Vec::new();
    for card in &cards {
        let Some(path) = card.game.folder_path.as_deref().map(Path::new).filter(|path| path.is_dir()) else {
            continue;
        };
        let (size_bytes, modified) = size_and_change(path);
        folders.push(MergeFolder {
            id: card.game.id,
            size_bytes,
            modified,
            saves: save_files(path).len(),
        });
        candidates.push(KeptCandidate {
            id: card.game.id,
            version: card.game.version_installed.as_deref(),
            modified,
        });
    }
    let kept_id = game_merge::pick_kept(&candidates);
    Ok(MergePreview { ids: ordered, reasons, kept_id, folders })
}

fn copy_saves(from: &Path, to: &Path) -> Result<(), String> {
    let failed = || format!("Не удалось скопировать сохранения из «{}» — проверьте место на диске.", folder_label(from));
    for copy in game_merge::saves_plan(&save_files(from), &save_files(to)) {
        let target = to.join(&copy.to);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|_| failed())?;
        }
        std::fs::copy(from.join(&copy.from), &target).map_err(|_| failed())?;
    }
    Ok(())
}

pub fn merge_apply(
    db: &Db,
    ids: &[i64],
    kept_id: i64,
    permanent_path: Option<&str>,
    recycle_bin: &dyn Fn(&Path) -> Recycle,
) -> Result<MergeOutcome, String> {
    let cards = with_conn(db, |conn| game_merge::merge_cards(conn, ids))?;
    let mut wanted = ids.to_vec();
    wanted.sort_unstable();
    wanted.dedup();
    if cards.len() < 2 || cards.len() != wanted.len() {
        return Err("Карточки изменились — откройте сравнение заново.".to_string());
    }
    let kept = cards
        .iter()
        .find(|card| card.game.id == kept_id)
        .ok_or_else(|| "Карточки изменились — откройте сравнение заново.".to_string())?;
    let kept_folder = kept
        .game
        .folder_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .ok_or_else(|| "Папки версии, которая остаётся, нет на диске.".to_string())?;
    let root = with_conn(db, stored_root)?.ok_or_else(|| "Папка с играми не выбрана.".to_string())?;
    let root = PathBuf::from(root);
    if !is_within(&root, &kept_folder) {
        return Err("Эта папка лежит вне папки с играми.".to_string());
    }

    let exe_found = cards[0]
        .game
        .exe_path
        .as_deref()
        .is_some_and(|relative| exe_inside(&kept_folder, relative).is_some());
    let plan = game_merge::plan_merge(&cards, kept_id, exe_found)
        .ok_or_else(|| "Эти карточки не получается объединить.".to_string())?;

    let leaving: Vec<PathBuf> = plan.trash.iter().map(PathBuf::from).filter(|path| path.is_dir()).collect();
    let kept_real = kept_folder.canonicalize().map_err(|_| "Папки версии, которая остаётся, нет на диске.".to_string())?;
    for folder in &leaving {
        if folder.canonicalize().map_or(true, |real| real == kept_real) {
            return Err("Старая и новая версии лежат в одной и той же папке — объединять нечего.".to_string());
        }
        if !is_within(&root, folder) {
            return Err(format!(
                "Папка «{}» лежит вне папки с играми — убирать её отсюда нельзя.",
                folder_label(folder)
            ));
        }
        if recycle::folder_is_busy(folder) {
            return Err(busy_text(folder));
        }
    }
    for folder in &leaving {
        copy_saves(folder, &kept_folder)?;
    }
    for folder in &leaving {
        match recycle_bin(folder) {
            Recycle::Done => {}
            Recycle::Refused if permanent_path.is_some_and(|agreed| Path::new(agreed) == folder.as_path()) => {
                if recycle::folder_is_busy(folder) {
                    return Err(busy_text(folder));
                }
                std::fs::remove_dir_all(folder).map_err(|_| busy_text(folder))?;
            }
            Recycle::Refused => {
                return Ok(MergeOutcome::NeedsPermanent {
                    folder: folder_label(folder),
                    path: folder.to_string_lossy().to_string(),
                    bytes: folder_size(folder),
                })
            }
            Recycle::Busy => return Err(busy_text(folder)),
            Recycle::Failed => {
                return Err(format!("Не удалось убрать папку «{}» в Корзину.", folder_label(folder)))
            }
        }
    }

    with_conn_mut(db, |conn| game_merge::apply_merge(conn, &plan))
        .map_err(|_| "Папки обновлены, но карточки не объединились — нажмите F5 и повторите.".to_string())?;
    Ok(MergeOutcome::Done { id: plan.survivor_id })
}

#[tauri::command]
pub async fn game_merge_preview(app: AppHandle, ids: Vec<i64>) -> Result<MergePreview, String> {
    tauri::async_runtime::spawn_blocking(move || merge_preview(&app.state::<Db>(), &ids))
        .await
        .map_err(|_| "Не удалось сравнить папки.".to_string())?
}

#[tauri::command]
pub async fn game_merge_apply(
    app: AppHandle,
    ids: Vec<i64>,
    kept_id: i64,
    permanent_path: Option<String>,
) -> Result<MergeOutcome, String> {
    let handle = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        merge_apply(&handle.state::<Db>(), &ids, kept_id, permanent_path.as_deref(), &recycle::to_recycle_bin)
    })
    .await
    .map_err(|_| "Не удалось объединить карточки.".to_string())?;
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    outcome
}

#[tauri::command]
pub fn game_mark_distinct(app: AppHandle, db: State<Db>, ids: Vec<i64>) -> Result<(), String> {
    with_conn_mut(&db, |conn| game_merge::mark_distinct(conn, &ids))?;
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

struct SiteRead {
    version: Option<String>,
    engine: Option<&'static str>,
}

async fn read_site(
    fetcher: &crate::net::Fetcher,
    source: games::Source,
    url: &str,
) -> Result<SiteRead, String> {
    let page = crate::net::fetch_document(fetcher, url)
        .await
        .map_err(|_| "Нет сети или сайт недоступен.".to_string())?;
    let html = booked_core::meta::decode_html(&page.body, &page.content_type);

    match source {
        games::Source::F95 => Ok(SiteRead {
            version: games::f95_version_from_html(&html),
            engine: games::engine_from_f95_html(&html),
        }),
        games::Source::Itch => {
            if let Some(stamp) = games::itch_updated_from_html(&html) {
                return Ok(SiteRead { version: Some(stamp), engine: None });
            }
            let devlog = devlog_url(url).ok_or_else(|| "Не удалось разобрать страницу.".to_string())?;
            let feed = crate::net::fetch_document(fetcher, &devlog)
                .await
                .map_err(|_| "Не удалось разобрать страницу.".to_string())?;
            let text = booked_core::meta::decode_html(&feed.body, &feed.content_type);
            Ok(SiteRead { version: games::itch_updated_from_devlog(&text), engine: None })
        }
    }
}

async fn grab_cover(
    app: &AppHandle,
    fetcher: &crate::net::Fetcher,
    source: games::Source,
    url: &str,
) -> Option<String> {
    let page = crate::net::fetch_document(fetcher, url).await.ok()?;
    let html = booked_core::meta::decode_html(&page.body, &page.content_type);
    let base = url::Url::parse(&page.final_url).ok()?;

    let from_post = if matches!(source, games::Source::F95) {
        games::f95_cover_from_html(&html).and_then(|raw| base.join(&raw).ok())
    } else {
        None
    };
    let image = match from_post {
        Some(found) => found,
        None => booked_core::meta::extract(&html, &base).image?,
    };

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
    let read = read_site(&fetcher, source, &url).await?;
    {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::record_check(conn, id, read.version.as_deref(), true))?;
        if let Some(engine) = read.engine {
            with_conn(&db, |conn| games::set_engine(conn, id, engine))?;
        }
    }

    let has_cover = {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::get(conn, id))?.and_then(|g| g.image).is_some()
    };
    if !has_cover {
        if let Some(file) = grab_cover(&app, &fetcher, source, &url).await {
            let db = app.state::<Db>();
            with_conn(&db, |conn| games::set_image(conn, id, Some(&file)))?;
        }
    }

    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub async fn game_refresh_cover(app: AppHandle, id: i64) -> Result<Option<String>, String> {
    let page = {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::get(conn, id))?
            .and_then(|game| game.page_url)
            .ok_or_else(|| "Сначала укажите страницу игры.".to_string())?
    };
    let source = games::source_from_url(&page)
        .ok_or_else(|| "Обложку можно взять только со страницы F95zone или itch.io.".to_string())?;

    let fetcher = app.state::<crate::net::Fetcher>();
    let file = grab_cover(&app, &fetcher, source, &page)
        .await
        .ok_or_else(|| "На странице не нашлось картинки для обложки.".to_string())?;

    {
        let db = app.state::<Db>();
        with_conn(&db, |conn| games::set_image(conn, id, Some(&file)))?;
    }
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    Ok(Some(file))
}

#[tauri::command]
pub fn game_skip_version(db: State<Db>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| games::skip_current_version(conn, id))
}

#[tauri::command]
pub fn game_open_page(app: AppHandle, db: State<Db>, id: i64) -> Result<(), String> {
    let page = with_conn(&db, |conn| games::get(conn, id))?
        .and_then(|game| game.page_url)
        .ok_or_else(|| "У этой игры не указана страница.".to_string())?;
    booked_core::browsers::is_launchable_url(&page)
        .map_err(|_| "Ссылка на страницу игры не открывается.".to_string())?;
    let target = with_conn(&db, booked_core::browsers::default_target)?;
    crate::bookmarks::resolve_and_open(&crate::browsers::avatars_dir_of(&app), &page, &target)
        .map(|_| ())
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
        match read_site(&fetcher, source, url).await {
            Ok(read) => {
                let db = app.state::<Db>();
                with_conn(&db, |conn| games::record_check(conn, *id, read.version.as_deref(), false))?;
                if let Some(engine) = read.engine {
                    with_conn(&db, |conn| games::set_engine(conn, *id, engine))?;
                }
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

        std::fs::create_dir_all(game.join("bin")).unwrap();
        std::fs::write(game.join("bin").join("Start.exe"), vec![0u8; 10]).unwrap();
        let absolute = game.join("bin").join("Start.exe").to_string_lossy().to_string();
        assert_eq!(relative_exe(&game, &absolute).as_deref(), Some("bin\\Start.exe"));
        assert_eq!(relative_exe(&game, "Game.exe").as_deref(), Some("Game.exe"));
        let escape = root.join("evil.exe").to_string_lossy().to_string();
        assert_eq!(relative_exe(&game, &escape), None);

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

    struct Library {
        root: PathBuf,
        bin: PathBuf,
        db: Db,
        old: i64,
        new: i64,
    }

    impl Drop for Library {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
            let _ = std::fs::remove_dir_all(&self.bin);
        }
    }

    fn write_at(path: &Path, bytes: &[u8], age_secs: u64) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
        let stamp = std::time::SystemTime::now() - Duration::from_secs(age_secs);
        std::fs::File::options().write(true).open(path).unwrap().set_modified(stamp).unwrap();
    }

    fn library(name: &str) -> Library {
        let root = temp_root(&format!("merge-{name}"));
        let bin = temp_root(&format!("merge-{name}-bin"));
        let old_dir = root.join("PathOfDesire-0.5.2-pc");
        let new_dir = root.join("PathOfDesire-0.6.2-pc");
        write_at(&old_dir.join("PathOfDesire.exe"), &[0u8; 64], 9000);
        write_at(&old_dir.join("game").join("script.rpy"), b"old script", 9000);
        write_at(&old_dir.join("game").join("saves").join("1-1-LT1.save"), b"old save", 5000);
        write_at(&old_dir.join("game").join("saves").join("persistent"), b"old persistent", 100);
        write_at(&new_dir.join("PathOfDesire.exe"), &[0u8; 64], 7000);
        write_at(&new_dir.join("game").join("script.rpy"), b"new script", 7000);
        write_at(&new_dir.join("game").join("saves").join("2-1-LT1.save"), b"new save", 3000);
        write_at(&new_dir.join("game").join("saves").join("persistent"), b"new persistent", 4000);

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        booked_core::db::migrate(&conn).unwrap();
        settings::write(&conn, GAMES_ROOT_KEY, &root.to_string_lossy()).unwrap();
        let db = Db(Mutex::new(Ok(conn)));
        sync_state(&db, &scan_root(&root)).unwrap();
        let id = |folder: &str| {
            with_conn(&db, |conn| {
                conn.query_row("SELECT id FROM games WHERE folder_name = ?1", [folder], |row| row.get(0))
            })
            .unwrap()
        };
        let (old, new) = (id("PathOfDesire-0.5.2-pc"), id("PathOfDesire-0.6.2-pc"));
        with_conn(&db, |conn| {
            conn.execute("UPDATE games SET created_at = created_at - 100 WHERE id = ?1", [old])
        })
        .unwrap();
        with_conn(&db, |conn| games::set_rating(conn, old, 4)).unwrap();
        Library { root, bin, db, old, new }
    }

    fn snapshot(db: &Db) -> String {
        let games = with_conn(db, games::list).unwrap();
        let marks = with_conn(db, game_merge::distinct_marks).unwrap();
        format!("{}{:?}", serde_json::to_string(&games).unwrap(), marks)
    }

    fn move_to(bin: &Path) -> impl Fn(&Path) -> Recycle + '_ {
        move |folder: &Path| {
            let target = bin.join(folder.file_name().unwrap());
            match std::fs::rename(folder, target) {
                Ok(()) => Recycle::Done,
                Err(_) => Recycle::Failed,
            }
        }
    }

    #[test]
    fn merge_apply_copies_saves_and_trashes_old_folder() {
        let lib = library("done");
        let old_dir = lib.root.join("PathOfDesire-0.5.2-pc");
        let new_dir = lib.root.join("PathOfDesire-0.6.2-pc");

        let groups = with_conn(&lib.db, game_merge::groups).unwrap();
        assert_eq!(groups.len(), 1);
        let preview = merge_preview(&lib.db, &groups[0].ids).unwrap();
        assert_eq!(preview.ids, vec![lib.old, lib.new]);
        assert_eq!(preview.kept_id, Some(lib.new));
        assert!(preview.reasons.as_ref().is_some_and(|r| r.name));
        assert_eq!(preview.folders.len(), 2);
        assert!(preview.folders.iter().all(|f| f.saves == 2 && f.size_bytes > 0 && f.modified.is_some()));

        let outcome = merge_apply(&lib.db, &preview.ids, lib.new, None, &move_to(&lib.bin)).unwrap();
        assert_eq!(outcome, MergeOutcome::Done { id: lib.old });
        assert!(!old_dir.exists());
        assert!(lib.bin.join("PathOfDesire-0.5.2-pc").join("game").join("script.rpy").is_file());

        let saves = new_dir.join("game").join("saves");
        assert_eq!(std::fs::read(saves.join("1-1-LT1.save")).unwrap(), b"old save");
        assert_eq!(std::fs::read(saves.join("2-1-LT1.save")).unwrap(), b"new save");
        assert_eq!(std::fs::read(saves.join("persistent")).unwrap(), b"old persistent");
        assert_eq!(std::fs::read(new_dir.join("game").join("script.rpy")).unwrap(), b"new script");

        let games_left = with_conn(&lib.db, games::list).unwrap();
        assert_eq!(games_left.len(), 1);
        assert_eq!(games_left[0].id, lib.old);
        assert_eq!(games_left[0].rating, 4);
        assert_eq!(games_left[0].folder_path.as_deref(), Some(new_dir.to_string_lossy().as_ref()));
        assert!(with_conn(&lib.db, game_merge::groups).unwrap().is_empty());
    }

    #[test]
    fn merge_apply_refused_bin_asks_before_deleting_for_good() {
        let lib = library("refused");
        let old_dir = lib.root.join("PathOfDesire-0.5.2-pc");
        let before = snapshot(&lib.db);
        let refuse = |_: &Path| Recycle::Refused;

        let outcome = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &refuse).unwrap();
        let asked = match outcome {
            MergeOutcome::NeedsPermanent { folder, path, bytes } => {
                assert_eq!(folder, "PathOfDesire-0.5.2-pc");
                assert!(bytes > 0);
                path
            }
            other => panic!("ожидали вопрос, получили {other:?}"),
        };
        assert!(old_dir.join("game").join("script.rpy").is_file());
        assert_eq!(snapshot(&lib.db), before);

        let elsewhere = lib.root.join("PathOfDesire-0.6.2-pc").to_string_lossy().to_string();
        let wrong = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, Some(&elsewhere), &refuse).unwrap();
        assert!(matches!(wrong, MergeOutcome::NeedsPermanent { .. }));
        assert!(old_dir.is_dir());
        assert_eq!(snapshot(&lib.db), before);

        let agreed = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, Some(&asked), &refuse).unwrap();
        assert_eq!(agreed, MergeOutcome::Done { id: lib.old });
        assert!(!old_dir.exists());
        assert_eq!(with_conn(&lib.db, games::list).unwrap().len(), 1);
    }

    #[test]
    fn merge_apply_failed_bin_leaves_db() {
        let lib = library("failed");
        let before = snapshot(&lib.db);
        let err = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &|_: &Path| Recycle::Failed).unwrap_err();
        assert_eq!(err, "Не удалось убрать папку «PathOfDesire-0.5.2-pc» в Корзину.");
        assert_eq!(snapshot(&lib.db), before);
        assert!(lib.root.join("PathOfDesire-0.5.2-pc").is_dir());

        let err = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &|_: &Path| Recycle::Busy).unwrap_err();
        assert_eq!(err, "Папка «PathOfDesire-0.5.2-pc» занята — закройте игру и повторите.");
        assert_eq!(snapshot(&lib.db), before);
    }

    #[test]
    fn merge_apply_busy_folder_leaves_everything() {
        use std::os::windows::fs::OpenOptionsExt;

        let lib = library("busy");
        let before = snapshot(&lib.db);
        let lock = std::fs::File::options()
            .read(true)
            .share_mode(0)
            .open(lib.root.join("PathOfDesire-0.5.2-pc").join("PathOfDesire.exe"))
            .unwrap();
        let called = std::cell::Cell::new(false);
        let spy = |_: &Path| {
            called.set(true);
            Recycle::Done
        };

        let err = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &spy).unwrap_err();
        assert_eq!(err, "Папка «PathOfDesire-0.5.2-pc» занята — закройте игру и повторите.");
        assert!(!called.get());
        assert_eq!(snapshot(&lib.db), before);
        assert!(!lib.root.join("PathOfDesire-0.6.2-pc").join("game").join("saves").join("1-1-LT1.save").exists());
        drop(lock);

        let outcome = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &move_to(&lib.bin)).unwrap();
        assert_eq!(outcome, MergeOutcome::Done { id: lib.old });
    }

    #[test]
    fn merge_apply_refuses_folders_outside_the_root() {
        let lib = library("outside");
        let elsewhere = temp_root("merge-outside-elsewhere");
        with_conn(&lib.db, |conn| settings::write(conn, GAMES_ROOT_KEY, &elsewhere.to_string_lossy())).unwrap();
        let before = snapshot(&lib.db);
        let err = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &move_to(&lib.bin)).unwrap_err();
        assert_eq!(err, "Эта папка лежит вне папки с играми.");
        assert_eq!(snapshot(&lib.db), before);
        assert!(lib.root.join("PathOfDesire-0.5.2-pc").is_dir());
        let _ = std::fs::remove_dir_all(&elsewhere);
    }

    #[test]
    fn merge_apply_consent_covers_only_the_named_folder() {
        let lib = library("three");
        let third = lib.root.join("PathOfDesire-0.7.0-pc");
        write_at(&third.join("PathOfDesire.exe"), &[0u8; 64], 10);
        sync_state(&lib.db, &scan_root(&lib.root)).unwrap();
        let group = with_conn(&lib.db, game_merge::groups).unwrap().remove(0);
        assert_eq!(group.ids.len(), 3);
        let newest = *group.ids.last().unwrap();
        let refuse = |_: &Path| Recycle::Refused;

        let first = match merge_apply(&lib.db, &group.ids, newest, None, &refuse).unwrap() {
            MergeOutcome::NeedsPermanent { path, .. } => path,
            other => panic!("ожидали вопрос, получили {other:?}"),
        };
        let second = match merge_apply(&lib.db, &group.ids, newest, Some(&first), &refuse).unwrap() {
            MergeOutcome::NeedsPermanent { path, .. } => path,
            other => panic!("вторая папка удалилась без вопроса: {other:?}"),
        };
        assert_ne!(first, second);
        assert!(!Path::new(&first).exists());
        assert!(Path::new(&second).is_dir());
        assert_eq!(with_conn(&lib.db, games::list).unwrap().len(), 3);

        let done = merge_apply(&lib.db, &group.ids, newest, Some(&second), &refuse).unwrap();
        assert_eq!(done, MergeOutcome::Done { id: group.ids[0] });
        assert!(!Path::new(&second).exists());
        assert!(third.is_dir());
        assert_eq!(with_conn(&lib.db, games::list).unwrap().len(), 1);
    }

    #[test]
    fn merge_apply_never_trashes_the_kept_folder_twice_named() {
        let lib = library("same");
        let new_dir = lib.root.join("PathOfDesire-0.6.2-pc").to_string_lossy().to_string();
        with_conn(&lib.db, |conn| {
            conn.execute("UPDATE games SET folder_path = ?1 WHERE id = ?2", rusqlite::params![new_dir, lib.old])
        })
        .unwrap();
        let before = snapshot(&lib.db);
        let never = |_: &Path| -> Recycle { panic!("остающаяся папка не должна уходить в Корзину") };
        let err = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &never).unwrap_err();
        assert_eq!(err, "Старая и новая версии лежат в одной и той же папке — объединять нечего.");
        assert_eq!(snapshot(&lib.db), before);
        assert!(Path::new(&new_dir).is_dir());
    }

    #[test]
    fn merge_apply_stale_window_is_refused() {
        let lib = library("stale");
        with_conn(&lib.db, |conn| games::forget(conn, lib.new)).unwrap();
        let err = merge_apply(&lib.db, &[lib.old, lib.new], lib.new, None, &move_to(&lib.bin)).unwrap_err();
        assert_eq!(err, "Карточки изменились — откройте сравнение заново.");
        assert!(lib.root.join("PathOfDesire-0.5.2-pc").is_dir());
    }

    #[test]
    fn merge_apply_missing_old_folder_has_nothing_to_trash() {
        let lib = library("missing");
        std::fs::remove_dir_all(lib.root.join("PathOfDesire-0.5.2-pc")).unwrap();
        sync_state(&lib.db, &scan_root(&lib.root)).unwrap();
        let groups = with_conn(&lib.db, game_merge::groups).unwrap();
        assert_eq!(groups.len(), 1);
        let preview = merge_preview(&lib.db, &groups[0].ids).unwrap();
        assert_eq!(preview.folders.len(), 1);
        assert_eq!(preview.kept_id, Some(lib.new));

        let never = |_: &Path| -> Recycle { panic!("в Корзину нечего убирать") };
        let outcome = merge_apply(&lib.db, &preview.ids, lib.new, None, &never).unwrap();
        assert_eq!(outcome, MergeOutcome::Done { id: lib.old });
        let saves = lib.root.join("PathOfDesire-0.6.2-pc").join("game").join("saves");
        assert!(!saves.join("1-1-LT1.save").exists());
        let left = with_conn(&lib.db, games::list).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].rating, 4);
    }

    #[test]
    fn save_listing_sees_only_save_places() {
        let root = temp_root("save-listing");
        write_at(&root.join("game").join("saves").join("1.save"), b"x", 10);
        write_at(&root.join("www").join("save").join("file1.rpgsave"), b"x", 10);
        write_at(&root.join("Save01.rvdata2"), b"x", 10);
        write_at(&root.join("game").join("script.rpy"), b"x", 10);
        write_at(&root.join("data").join("Save02.rvdata2"), b"x", 10);
        let mut rels: Vec<String> = save_files(&root).into_iter().map(|f| f.rel).collect();
        rels.sort();
        assert_eq!(rels, vec!["Save01.rvdata2", "game/saves/1.save", "www/save/file1.rpgsave"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
