use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use booked_core::archive_match::{self, FileSeen, Watch};
use booked_core::cloud::now_ms;
use booked_core::downloads::{self, Job, Queue, QueueError, Reason, Snapshot};
use booked_core::{games, settings};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;

use crate::db::{with_conn, Db};
use crate::game_import::{import_path, GamesImport, Report, HOLDER_QUEUE};
use crate::games::stored_root;

const DOWNLOADS_EVENT: &str = "games:downloads";
const IMPORT_POLL: Duration = Duration::from_secs(1);
const WATCH_POLL: Duration = Duration::from_secs(2);
const TEMP_PREFIX: &str = ".booked-download-";
const IGNORED_KEY: &str = "downloads_ignored";
const F95_POST_PREFIX: &str = "https://f95zone.to/dl/";

#[derive(Default)]
pub struct GameDownloads {
    queue: Mutex<Queue>,
    watch: Mutex<Watch>,
    wake: Notify,
    active: Mutex<Option<(u64, Arc<AtomicBool>)>>,
    persist_lock: Mutex<()>,
}

enum Stop {
    Cancelled,
    Failed(Reason, Option<String>),
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<GameDownloads>();
    let snapshot = lock(&state.queue).snapshot();
    snapshot
}

fn persist(app: &AppHandle) {
    let state = app.state::<GameDownloads>();
    let _guard = lock(&state.persist_lock);
    let saved = lock(&state.queue).saved();
    let _ = with_conn(&app.state::<Db>(), |conn| downloads::save_queue(conn, &saved));
}

fn emit(app: &AppHandle) {
    let _ = app.emit(DOWNLOADS_EVENT, snapshot(app));
}

fn changed(app: &AppHandle) {
    app.state::<GameDownloads>().wake.notify_one();
    persist(app);
    emit(app);
}

fn downloads_dir() -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KF_FLAG_DEFAULT};

    if let Ok(raw) = unsafe { SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None) } {
        let path = unsafe { raw.to_string() }.ok();
        unsafe { CoTaskMemFree(Some(raw.0 as *const _)) };
        if let Some(path) = path {
            return Some(PathBuf::from(path));
        }
    }
    std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("Downloads"))
}

fn millis(time: std::io::Result<SystemTime>) -> Option<i64> {
    let since = time.ok()?.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(since.as_millis()).ok()
}

fn list_archives(dir: &Path) -> Vec<FileSeen> {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;

    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| archive_match::is_archive_name(&entry.file_name().to_string_lossy()))
        .filter_map(|entry| {
            let path = entry.path();
            let meta = fs::metadata(&path).ok().filter(|meta| meta.is_file() && meta.file_attributes() & HIDDEN == 0)?;
            Some(FileSeen {
                size: meta.len(),
                modified: millis(meta.modified())?,
                created: millis(meta.created())?,
                path,
            })
        })
        .collect()
}

fn scan(app: &AppHandle, dir: &Path) {
    let state = app.state::<GameDownloads>();
    let Some(since) = lock(&state.queue).waiting_since() else {
        lock(&state.watch).idle();
        return;
    };
    let files = list_archives(dir);
    let ready = {
        let queue = lock(&state.queue);
        let ready = lock(&state.watch).poll(files, since, |path| queue.knows(path));
        ready
    };
    if ready.is_empty() {
        return;
    }
    {
        let mut queue = lock(&state.queue);
        for path in ready {
            let waiting = queue.waiting();
            if waiting.is_empty() {
                break;
            }
            let pairs: Vec<(u64, &str)> = waiting.iter().map(|(id, title)| (*id, title.as_str())).collect();
            let name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
            match archive_match::match_archive(&name, &pairs).as_slice() {
                [one] => {
                    let _ = queue.catch(*one, path);
                }
                found => {
                    let found = found.to_vec();
                    queue.offer(path, found);
                }
            }
        }
    }
    changed(app);
}

async fn watch_loop(app: AppHandle) {
    let Some(dir) = downloads_dir() else {
        return;
    };
    loop {
        scan(&app, &dir);
        tokio::time::sleep(WATCH_POLL).await;
    }
}

fn free_space(path: &Path) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let mut free = 0u64;
    let target = HSTRING::from(path.as_os_str());
    unsafe { GetDiskFreeSpaceExW(&target, Some(&mut free as *mut u64), None, None) }.ok()?;
    Some(free)
}

fn check_space(app: &AppHandle, archive: &Path) -> Result<(), Stop> {
    let Ok(meta) = fs::metadata(archive) else {
        return Err(Stop::Failed(Reason::Missing, None));
    };
    let root = with_conn(&app.state::<Db>(), stored_root).ok().flatten().map(PathBuf::from);
    if let Some(free) = root.as_deref().and_then(free_space) {
        if free < meta.len() {
            return Err(Stop::Failed(Reason::NoSpace, None));
        }
    }
    Ok(())
}

async fn unpack(app: &AppHandle, job: &Job, cancel: &Arc<AtomicBool>) -> Result<(), Stop> {
    check_space(app, &job.archive)?;
    let imports = app.state::<GamesImport>();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(Stop::Cancelled);
        }
        if imports.try_begin(HOLDER_QUEUE) {
            break;
        }
        tokio::time::sleep(IMPORT_POLL).await;
    }
    let report: Report = {
        let app = app.clone();
        let id = job.id;
        Arc::new(move |done, total| {
            let state = app.state::<GameDownloads>();
            lock(&state.queue).unpack_progress(id, done, total);
            emit(&app);
        })
    };
    let outcome = import_path(app, job.archive.clone(), Some(job.game), cancel.clone(), Some(report)).await;
    imports.end();
    match outcome {
        Ok(imported) => {
            let filled = with_conn(&app.state::<Db>(), |conn| games::fill_version_from_site(conn, imported.id()));
            if filled.is_ok() {
                let _ = app.emit(crate::games::GAMES_CHANGED_EVENT, ());
            }
            Ok(())
        }
        Err(_) if cancel.load(Ordering::SeqCst) => Err(Stop::Cancelled),
        Err(text) => Err(Stop::Failed(Reason::Unpack, Some(text))),
    }
}

async fn process(app: &AppHandle, job: Job) {
    let state = app.state::<GameDownloads>();
    let cancel = Arc::new(AtomicBool::new(false));
    *lock(&state.active) = Some((job.id, cancel.clone()));
    emit(app);

    let outcome = unpack(app, &job, &cancel).await;

    *lock(&state.active) = None;
    if outcome.is_ok() && job.archive.exists() {
        if let Err(err) = fs::remove_file(&job.archive) {
            eprintln!("downloads: не удалён архив {}: {err}", job.archive.display());
        }
    }
    {
        let mut queue = lock(&state.queue);
        match outcome {
            Ok(()) => queue.finish(job.id),
            Err(Stop::Cancelled) => {}
            Err(Stop::Failed(reason, None)) => queue.fail(job.id, reason),
            Err(Stop::Failed(reason, Some(text))) => queue.fail_with_message(job.id, reason, &text),
        }
    }
    persist(app);
    emit(app);
}

async fn unpack_loop(app: AppHandle) {
    let state = app.state::<GameDownloads>();
    loop {
        let job = lock(&state.queue).take_unpack();
        match job {
            Some(job) => process(&app, job).await,
            None => state.wake.notified().await,
        }
    }
}

fn sweep_orphans(app: &AppHandle) {
    let Ok(Some(root)) = with_conn(&app.state::<Db>(), stored_root) else {
        return;
    };
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(TEMP_PREFIX) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn ignored(app: &AppHandle) -> Vec<String> {
    with_conn(&app.state::<Db>(), |conn| settings::value(conn, IGNORED_KEY))
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn restore(app: &AppHandle) {
    let saved = with_conn(&app.state::<Db>(), downloads::load_queue).unwrap_or_default();
    let state = app.state::<GameDownloads>();
    lock(&state.queue).restore(saved, |game| restorable(app, game));
    *lock(&state.watch) = Watch::new(ignored(app).into_iter().map(PathBuf::from));
    persist(app);
}

pub fn setup(app: &AppHandle) {
    restore(app);
    sweep_orphans(app);
    tauri::async_runtime::spawn(unpack_loop(app.clone()));
    tauri::async_runtime::spawn(watch_loop(app.clone()));
}

fn restorable(app: &AppHandle, id: i64) -> Option<String> {
    let game = with_conn(&app.state::<Db>(), |conn| games::get(conn, id)).ok().flatten()?;
    game.folder_path.is_none().then_some(game.title)
}

fn eligible(app: &AppHandle, id: i64) -> Result<Option<(String, Option<String>)>, String> {
    let db = app.state::<Db>();
    let Some(game) = with_conn(&db, |conn| games::get(conn, id))? else {
        return Ok(None);
    };
    let thread = game.page_url.as_deref().and_then(games::f95_thread_id);
    if game.status != "wish" || game.folder_path.is_some() || thread.is_none() {
        return Ok(None);
    }
    let topic = game
        .download_links
        .iter()
        .find(|link| link.url.starts_with(F95_POST_PREFIX))
        .map(|link| games::download_open_url(&link.url))
        .or(game.page_url);
    Ok(Some((game.title, topic)))
}

#[tauri::command]
pub fn game_downloads(state: State<GameDownloads>) -> Snapshot {
    let snapshot = lock(&state.queue).snapshot();
    snapshot
}

#[tauri::command]
pub async fn game_download_add(app: AppHandle, ids: Vec<i64>) -> Result<Snapshot, String> {
    let mut found = Vec::new();
    for id in ids {
        if let Some(item) = eligible(&app, id)? {
            found.push((id, item));
        }
    }
    let now = now_ms();
    let state = app.state::<GameDownloads>();
    {
        let mut queue = lock(&state.queue);
        for (id, (title, _)) in &found {
            queue.add(*id, title, now);
        }
    }
    changed(&app);
    let topics: Vec<String> = found.into_iter().filter_map(|(_, (_, topic))| topic).collect();
    let target = with_conn(&app.state::<Db>(), booked_core::browsers::default_target)?;
    crate::bookmarks::resolve_and_open_many(&crate::browsers::avatars_dir_of(&app), &topics, &target)
        .map_err(|_| "Не получилось открыть темы в браузере — открой их кнопкой «Открыть тему»".to_string())?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn game_download_cancel(app: AppHandle, id: u64) -> Snapshot {
    let state = app.state::<GameDownloads>();
    let removed = lock(&state.queue).cancel(id);
    if removed.is_some() {
        if let Some((current, flag)) = lock(&state.active).as_ref() {
            if *current == id {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }
    changed(&app);
    snapshot(&app)
}

#[tauri::command]
pub fn game_download_retry(app: AppHandle, id: u64) -> Snapshot {
    lock(&app.state::<GameDownloads>().queue).retry(id, Path::is_file);
    changed(&app);
    snapshot(&app)
}

#[tauri::command]
pub fn game_download_claim(app: AppHandle, unclaimed: u64, row: u64) -> Result<Snapshot, String> {
    let outcome = lock(&app.state::<GameDownloads>().queue).claim(unclaimed, row);
    match outcome {
        Err(QueueError::Unknown) => return Err("Этой строки уже нет в панели «Загрузки»".to_string()),
        Err(QueueError::WrongState) => return Err("Эта игра уже не ждёт файл".to_string()),
        Ok(()) => {}
    }
    changed(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn game_download_dismiss_unclaimed(app: AppHandle, unclaimed: u64) -> Snapshot {
    let path = lock(&app.state::<GameDownloads>().queue).dismiss_unclaimed(unclaimed);
    if let Some(path) = path {
        let list = archive_match::remember_ignored(ignored(&app), &path.to_string_lossy());
        if let Ok(raw) = serde_json::to_string(&list) {
            let _ = with_conn(&app.state::<Db>(), |conn| settings::write(conn, IGNORED_KEY, &raw));
        }
    }
    emit(&app);
    snapshot(&app)
}

#[tauri::command]
pub fn game_download_reveal(app: AppHandle, id: u64) -> Result<(), String> {
    let archive = lock(&app.state::<GameDownloads>().queue).archive_of(id).filter(|path| path.is_file());
    let archive = archive.ok_or_else(|| "Архива уже нет в папке «Загрузки» — скачай его снова".to_string())?;
    tauri_plugin_opener::reveal_item_in_dir(archive).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn game_download_dismiss(app: AppHandle) -> Snapshot {
    let state = app.state::<GameDownloads>();
    lock(&state.queue).dismiss_done();
    emit(&app);
    snapshot(&app)
}
