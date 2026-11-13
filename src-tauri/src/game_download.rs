use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use booked_core::bridge::{self, Parse, Request, Response};
use booked_core::cloud::now_ms;
use booked_core::download_hosts as hosts;
use booked_core::downloads::{self, Download, Known, Part, Queue, Reason, Resume, Snapshot};
use booked_core::games;
use reqwest::StatusCode;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;

use crate::cloud::Cloud;
use crate::db::{with_conn, Db};
use crate::game_import::{import_path, GamesImport, Report, HOLDER_QUEUE};
use crate::games::stored_root;

const DOWNLOADS_EVENT: &str = "games:downloads";
const BRIDGE_PORT: u16 = 47295;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const EMIT_GAP: Duration = Duration::from_millis(250);
const CANCEL_POLL: Duration = Duration::from_millis(500);
const IMPORT_POLL: Duration = Duration::from_secs(1);
const IDLE_POLL: Duration = Duration::from_secs(2);
const BRIDGE_WAIT_STEPS: u32 = 6;
const TEMP_PREFIX: &str = ".booked-download-";
const PART_SUFFIX: &str = ".booked-part";
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const EMPTY_JOB: &str = r#"{"job":null}"#;

#[derive(Default)]
pub struct GameDownloads {
    queue: Mutex<Queue>,
    wake: Notify,
    active: Mutex<Option<(u64, Arc<AtomicBool>)>>,
    bridge_up: AtomicBool,
    persist_lock: Mutex<()>,
}

enum Stop {
    Cancelled,
    Failed(Reason, Option<String>),
}

impl From<Reason> for Stop {
    fn from(reason: Reason) -> Self {
        Stop::Failed(reason, None)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<GameDownloads>();
    let snapshot = lock(&state.queue).snapshot(now_ms());
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

fn bridge_failure(app: &AppHandle) -> Option<Reason> {
    if app.state::<Cloud>().key().is_none() {
        return Some(Reason::CloudKey);
    }
    if app.state::<GameDownloads>().bridge_up.load(Ordering::SeqCst) {
        None
    } else {
        Some(Reason::Bridge)
    }
}

fn respond(app: &AppHandle, request: &Request) -> Response {
    let Some(key) = app.state::<Cloud>().key() else {
        return Response::empty(401);
    };
    let state = app.state::<GameDownloads>();
    let response = bridge::handle(request, &key, &mut lock(&state.queue), now_ms());
    let posted = request.method == "POST" && response.status != 401 && response.status != 403;
    let changed = posted || response.body.as_deref().is_some_and(|body| body != EMPTY_JOB);
    if (response.is_success() || posted) && changed {
        state.wake.notify_one();
        if request.method == "POST" {
            persist(app);
        }
        emit(app);
    }
    response
}

async fn read_request(stream: &mut TcpStream) -> Option<Parse> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
        match bridge::parse_request(&buffer) {
            Parse::More => continue,
            done => return Some(done),
        }
    }
}

async fn connection(app: AppHandle, mut stream: TcpStream) {
    let Ok(Some(parsed)) = tokio::time::timeout(READ_TIMEOUT, read_request(&mut stream)).await else {
        return;
    };
    let response = match parsed {
        Parse::Done(request) => respond(&app, &request),
        Parse::TooLarge => Response::empty(413),
        Parse::Bad | Parse::More => Response::empty(400),
    };
    let _ = stream.write_all(&bridge::response_bytes(&response)).await;
    let _ = stream.shutdown().await;
}

async fn serve(app: AppHandle) {
    let mut listener: Option<TcpListener> = None;
    let state = app.state::<GameDownloads>();
    loop {
        if app.state::<Cloud>().key().is_none() {
            listener = None;
            state.bridge_up.store(false, Ordering::SeqCst);
            tokio::time::sleep(IDLE_POLL).await;
            continue;
        }
        if listener.is_none() {
            match TcpListener::bind(("127.0.0.1", BRIDGE_PORT)).await {
                Ok(bound) => listener = Some(bound),
                Err(_) => {
                    state.bridge_up.store(false, Ordering::SeqCst);
                    tokio::time::sleep(IDLE_POLL * 2).await;
                    continue;
                }
            }
        }
        state.bridge_up.store(true, Ordering::SeqCst);
        let Some(bound) = listener.as_ref() else { continue };
        tokio::select! {
            accepted = bound.accept() => match accepted {
                Ok((stream, _)) => {
                    tauri::async_runtime::spawn(connection(app.clone(), stream));
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(200)).await,
            },
            _ = tokio::time::sleep(IDLE_POLL) => {}
        }
    }
}

fn status_reason(status: StatusCode) -> Option<Reason> {
    if status.is_success() {
        return None;
    }
    Some(match status.as_u16() {
        429 => Reason::Limit,
        401 | 403 | 404 | 410 => Reason::Expired,
        _ => Reason::Network,
    })
}

async fn send(builder: reqwest::RequestBuilder, cancel: &AtomicBool) -> Result<reqwest::Response, Stop> {
    let pending = builder.send();
    tokio::pin!(pending);
    loop {
        match tokio::time::timeout(CANCEL_POLL, &mut pending).await {
            Ok(result) => return result.map_err(|_| Stop::from(Reason::Network)),
            Err(_) if cancel.load(Ordering::SeqCst) => return Err(Stop::Cancelled),
            Err(_) => {}
        }
    }
}

async fn read_page(mut response: reqwest::Response, cancel: &AtomicBool) -> Result<String, Stop> {
    let mut body = Vec::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(Stop::Cancelled);
        }
        match tokio::time::timeout(CANCEL_POLL, response.chunk()).await {
            Err(_) => {}
            Ok(Err(_)) => return Err(Reason::Network.into()),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(chunk))) => {
                body.extend_from_slice(&chunk);
                if body.len() > MAX_PAGE_BYTES {
                    return Err(Reason::Other.into());
                }
            }
        }
    }
    Ok(String::from_utf8_lossy(&body).to_string())
}

async fn direct_url(client: &reqwest::Client, job: &Download, cancel: &AtomicBool) -> Result<String, Stop> {
    if let Some(file) = &job.file {
        return Ok(file.clone());
    }
    match job.host.as_str() {
        hosts::PIXELDRAIN => Ok(hosts::pixeldrain_direct(&job.url)?),
        hosts::MEDIAFIRE => {
            let response = send(client.get(&job.url), cancel).await?;
            if let Some(reason) = status_reason(response.status()) {
                return Err(reason.into());
            }
            let html = read_page(response, cancel).await?;
            Ok(hosts::mediafire_direct(&html)?)
        }
        _ => Err(Reason::Other.into()),
    }
}

#[cfg(windows)]
fn free_space(path: &Path) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let mut free = 0u64;
    let target = HSTRING::from(path.as_os_str());
    unsafe { GetDiskFreeSpaceExW(&target, Some(&mut free as *mut u64), None, None) }.ok()?;
    Some(free)
}

fn write_failed(err: &std::io::Error) -> Stop {
    if err.kind() == std::io::ErrorKind::StorageFull {
        return Stop::Failed(Reason::NoSpace, None);
    }
    Stop::Failed(Reason::Other, Some("Не удалось записать скачанный файл в папку с играми — проверь место и доступ к папке и нажми «Повторить»".to_string()))
}

fn alive(app: &AppHandle, id: u64, received: u64, total: Option<u64>) -> bool {
    let state = app.state::<GameDownloads>();
    let alive = lock(&state.queue).progress(id, received, total, now_ms());
    alive
}

fn kept_archive(dir: &Path, part: Option<&Part>) -> Option<PathBuf> {
    let part = part?;
    let ready = dir.join(&part.name);
    let size = fs::metadata(&ready).ok().filter(|meta| meta.is_file())?.len();
    (size > 0 && part.total.is_none_or(|total| total == size)).then_some(ready)
}

fn part_dir(app: &AppHandle, part: &Part) -> Option<PathBuf> {
    if !part.dir.starts_with(TEMP_PREFIX) || part.dir.contains(['/', '\\']) {
        return None;
    }
    let root = with_conn(&app.state::<Db>(), stored_root).ok().flatten()?;
    Some(PathBuf::from(root).join(&part.dir))
}

async fn download(
    app: &AppHandle,
    client: &reqwest::Client,
    job: &Download,
    root: &Path,
    dir: &Path,
    cancel: &AtomicBool,
) -> Result<PathBuf, Stop> {
    if let Some(ready) = kept_archive(dir, job.part.as_ref()) {
        return Ok(ready);
    }
    let direct = direct_url(client, job, cancel).await?;
    if cancel.load(Ordering::SeqCst) {
        return Err(Stop::Cancelled);
    }
    let saved_total = job.part.as_ref().and_then(|part| part.total);
    let old_path = job.part.as_ref().map(|part| dir.join(format!("{}{PART_SUFFIX}", part.name)));
    let mut have = match &old_path {
        Some(path) => tokio::fs::metadata(path).await.map(|meta| meta.len()).unwrap_or(0),
        None => 0,
    };
    if let (Some(path), Some(part)) = (&old_path, &job.part) {
        if have > 0 && saved_total == Some(have) {
            let ready = dir.join(&part.name);
            tokio::fs::rename(path, &ready).await.map_err(|err| write_failed(&err))?;
            return Ok(ready);
        }
        if saved_total.is_some_and(|total| have > total) {
            let _ = tokio::fs::remove_file(path).await;
            have = 0;
        }
    }
    let mut builder = client.get(&direct);
    if have > 0 {
        builder = builder.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = send(builder, cancel).await?;
    if have > 0 && response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
        if let Some(path) = &old_path {
            let _ = tokio::fs::remove_file(path).await;
        }
        have = 0;
        response = send(client.get(&direct), cancel).await?;
    }
    if let Some(reason) = status_reason(response.status()) {
        return Err(reason.into());
    }
    let content_range = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .map(|value| String::from_utf8_lossy(value.as_bytes()).to_string());
    let decision = downloads::resume_decision(have, saved_total, response.status().as_u16(), content_range.as_deref());
    if decision == Resume::Restart && response.status() == StatusCode::PARTIAL_CONTENT {
        if let Some(path) = &old_path {
            let _ = tokio::fs::remove_file(path).await;
        }
        response = send(client.get(&direct), cancel).await?;
        if let Some(reason) = status_reason(response.status()) {
            return Err(reason.into());
        }
        if response.status() == StatusCode::PARTIAL_CONTENT {
            return Err(Reason::Network.into());
        }
    }
    let (name, offset, total) = match (decision, &job.part) {
        (Resume::Append(offset), Some(part)) => (part.name.clone(), offset, saved_total),
        _ => {
            let disposition = response
                .headers()
                .get(reqwest::header::CONTENT_DISPOSITION)
                .map(|value| String::from_utf8_lossy(value.as_bytes()).to_string());
            let name = hosts::file_name_for(disposition.as_deref(), response.url().as_str())
                .filter(|name| hosts::is_archive_name(name))
                .ok_or(Reason::NotArchive)?;
            if let Some(path) = &old_path {
                let _ = tokio::fs::remove_file(path).await;
            }
            (name, 0, response.content_length().filter(|length| *length > 0))
        }
    };
    if let (Some(total), Some(free)) = (total, free_space(root)) {
        if free < total.saturating_sub(offset) {
            return Err(Reason::NoSpace.into());
        }
    }
    tokio::fs::create_dir_all(dir).await.map_err(|err| write_failed(&err))?;
    let part = dir.join(format!("{name}{PART_SUFFIX}"));
    let mut file = if offset > 0 {
        tokio::fs::OpenOptions::new().append(true).open(&part).await
    } else {
        tokio::fs::File::create(&part).await
    }
    .map_err(|err| write_failed(&err))?;

    {
        let state = app.state::<GameDownloads>();
        let dir_name = dir.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
        lock(&state.queue).set_part(job.id, Some(Part { dir: dir_name, name: name.clone(), total }));
    }
    persist(app);
    if !alive(app, job.id, offset, total) {
        return Err(Stop::Cancelled);
    }
    emit(app);

    let mut received = offset;
    let mut last_emit = Instant::now();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(Stop::Cancelled);
        }
        let chunk = match tokio::time::timeout(CANCEL_POLL, response.chunk()).await {
            Err(_) => continue,
            Ok(Err(_)) => return Err(Reason::Network.into()),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(chunk))) => chunk,
        };
        file.write_all(&chunk).await.map_err(|err| write_failed(&err))?;
        received += chunk.len() as u64;
        if !alive(app, job.id, received, total) {
            return Err(Stop::Cancelled);
        }
        if last_emit.elapsed() >= EMIT_GAP {
            last_emit = Instant::now();
            emit(app);
        }
    }
    file.flush().await.map_err(|err| write_failed(&err))?;
    drop(file);
    if total.is_some_and(|expected| expected != received) {
        return Err(Reason::Network.into());
    }
    let ready = dir.join(&name);
    tokio::fs::rename(&part, &ready).await.map_err(|err| write_failed(&err))?;
    Ok(ready)
}

async fn unpack(app: &AppHandle, job: &Download, archive: PathBuf, cancel: &Arc<AtomicBool>) -> Result<(), Stop> {
    let started = {
        let state = app.state::<GameDownloads>();
        let started = lock(&state.queue).start_unpack(job.id);
        started
    };
    if !started {
        return Err(Stop::Cancelled);
    }
    emit(app);

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
    let outcome = import_path(app, archive, Some(job.game), cancel.clone(), Some(report)).await;
    imports.end();
    match outcome {
        Ok(imported) => {
            let filled = with_conn(&app.state::<Db>(), |conn| {
                booked_core::games::fill_version_from_site(conn, imported.id())
            });
            if filled.is_ok() {
                let _ = app.emit(crate::games::GAMES_CHANGED_EVENT, ());
            }
            Ok(())
        }
        Err(_) if cancel.load(Ordering::SeqCst) => Err(Stop::Cancelled),
        Err(text) => Err(Stop::Failed(Reason::Unpack, Some(text))),
    }
}

async fn process(app: &AppHandle, client: &reqwest::Client, job: Download) {
    let state = app.state::<GameDownloads>();
    let cancel = Arc::new(AtomicBool::new(false));
    *lock(&state.active) = Some((job.id, cancel.clone()));

    let root = with_conn(&app.state::<Db>(), stored_root)
        .ok()
        .flatten()
        .map(PathBuf::from)
        .filter(|root| root.is_dir());
    let dir_name = job
        .part
        .as_ref()
        .map(|part| part.dir.clone())
        .filter(|name| name.starts_with(TEMP_PREFIX) && !name.contains(['/', '\\']))
        .unwrap_or_else(|| format!("{TEMP_PREFIX}g{}", job.game));
    let dir = root.as_ref().map(|root| root.join(dir_name));
    let outcome = match (&root, &dir) {
        (Some(root), Some(dir)) => match download(app, client, &job, root, dir, &cancel).await {
            Ok(archive) => unpack(app, &job, archive, &cancel).await,
            Err(stop) => Err(stop),
        },
        _ => Err(Stop::Failed(Reason::Other, Some("Папка с играми не задана или недоступна — выбери её в настройках".to_string()))),
    };

    *lock(&state.active) = None;
    let keep_part = matches!(outcome, Err(Stop::Failed(Reason::Network | Reason::Unpack, _)));
    if !keep_part {
        if let Some(dir) = dir {
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
        lock(&state.queue).set_part(job.id, None);
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

async fn work(app: AppHandle) {
    let built = reqwest::Client::builder()
        .user_agent(crate::net::UA)
        .no_gzip()
        .no_brotli()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("слишком много переходов")
            } else if hosts::is_public_https(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .build();
    let Ok(client) = built else {
        return;
    };
    let state = app.state::<GameDownloads>();
    loop {
        let job = lock(&state.queue).take_download();
        match job {
            Some(job) => process(&app, &client, job).await,
            None => {
                tokio::select! {
                    _ = state.wake.notified() => {}
                    _ = tokio::time::sleep(IDLE_POLL) => {}
                }
            }
        }
    }
}

fn sweep_orphans(app: &AppHandle, keep: &[String]) {
    let Ok(Some(root)) = with_conn(&app.state::<Db>(), stored_root) else {
        return;
    };
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(TEMP_PREFIX) && !keep.contains(&name) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn restore(app: &AppHandle) -> Vec<String> {
    let saved = with_conn(&app.state::<Db>(), downloads::load_queue).unwrap_or_default();
    let state = app.state::<GameDownloads>();
    let keep = {
        let mut queue = lock(&state.queue);
        queue.restore(
            saved,
            |game| {
                restorable(app, game)
            },
            now_ms(),
        );
        queue.part_dirs()
    };
    persist(app);
    keep
}

pub fn setup(app: &AppHandle) {
    let keep = restore(app);
    sweep_orphans(app, &keep);
    tauri::async_runtime::spawn(serve(app.clone()));
    tauri::async_runtime::spawn(work(app.clone()));
}

fn restorable(app: &AppHandle, id: i64) -> Option<Known> {
    let game = with_conn(&app.state::<Db>(), |conn| games::get(conn, id)).ok().flatten()?;
    if game.folder_path.is_some() {
        return None;
    }
    let thread = game
        .page_url
        .as_deref()
        .and_then(games::f95_thread_id)
        .and_then(|thread| thread.parse::<i64>().ok())
        .unwrap_or(0);
    Some(Known { thread, title: game.title, hosts: hosts::supported_hosts(&game.download_links) })
}

fn eligible(app: &AppHandle, id: i64) -> Result<Option<(i64, String, Vec<String>)>, String> {
    let db = app.state::<Db>();
    let Some(game) = with_conn(&db, |conn| games::get(conn, id))? else {
        return Ok(None);
    };
    let thread = game
        .page_url
        .as_deref()
        .and_then(games::f95_thread_id)
        .and_then(|thread| thread.parse::<i64>().ok());
    let supported = hosts::supported_hosts(&game.download_links);
    if game.status != "wish" || game.folder_path.is_some() || supported.is_empty() {
        return Ok(None);
    }
    Ok(thread.map(|thread| (thread, game.title, supported)))
}

#[tauri::command]
pub fn game_downloads(state: State<GameDownloads>) -> Snapshot {
    let snapshot = lock(&state.queue).snapshot(now_ms());
    snapshot
}

async fn wait_bridge(app: &AppHandle) {
    if app.state::<Cloud>().key().is_none() {
        return;
    }
    for _ in 0..BRIDGE_WAIT_STEPS {
        if app.state::<GameDownloads>().bridge_up.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(CANCEL_POLL).await;
    }
}

#[tauri::command]
pub async fn game_download_add(app: AppHandle, ids: Vec<i64>) -> Result<Snapshot, String> {
    wait_bridge(&app).await;
    let mut found = Vec::new();
    for id in ids {
        if let Some((thread, title, supported)) = eligible(&app, id)? {
            found.push((id, thread, title, supported));
        }
    }
    let failure = bridge_failure(&app);
    let state = app.state::<GameDownloads>();
    {
        let mut queue = lock(&state.queue);
        for (id, thread, title, supported) in found {
            let added = queue.add(id, thread, &title, supported, now_ms());
            if let (Some(row), Some(reason)) = (added, failure) {
                queue.fail(row, reason);
            }
        }
    }
    state.wake.notify_one();
    persist(&app);
    emit(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
pub async fn game_download_cancel(app: AppHandle, id: u64) -> Snapshot {
    let state = app.state::<GameDownloads>();
    let (part, removed) = {
        let mut queue = lock(&state.queue);
        (queue.part_of(id), queue.cancel(id))
    };
    if removed.is_some() {
        let active = lock(&state.active);
        let mut running = false;
        if let Some((current, flag)) = active.as_ref() {
            if *current == id {
                running = true;
                flag.store(true, Ordering::SeqCst);
            }
        }
        if let (false, Some(dir)) = (running, part.as_ref().and_then(|part| part_dir(&app, part))) {
            let _ = fs::remove_dir_all(dir);
        }
        drop(active);
    }
    persist(&app);
    state.wake.notify_one();
    emit(&app);
    snapshot(&app)
}

#[tauri::command]
pub async fn game_download_retry(app: AppHandle, id: u64) -> Snapshot {
    wait_bridge(&app).await;
    let failure = bridge_failure(&app);
    let state = app.state::<GameDownloads>();
    let (part, reusable) = {
        let queue = lock(&state.queue);
        (queue.part_of(id), queue.can_reuse_archive(id))
    };
    let dir = part.as_ref().and_then(|part| part_dir(&app, part));
    let kept = reusable && dir.as_ref().is_some_and(|dir| kept_archive(dir, part.as_ref()).is_some());
    let stale = {
        let mut queue = lock(&state.queue);
        if kept && queue.retry_unpack(id) {
            false
        } else {
            let unpack_failed = queue.reason_of(id) == Some(Reason::Unpack);
            if queue.retry(id, now_ms()) {
                if unpack_failed {
                    queue.set_part(id, None);
                }
                if let Some(reason) = failure {
                    queue.fail(id, reason);
                }
                unpack_failed
            } else {
                false
            }
        }
    };
    if let (true, Some(dir)) = (stale, dir) {
        let _ = tokio::fs::remove_dir_all(dir).await;
    }
    state.wake.notify_one();
    persist(&app);
    emit(&app);
    snapshot(&app)
}

#[tauri::command]
pub fn game_download_reveal(app: AppHandle, id: u64) -> Result<(), String> {
    let gone = || "Архива уже нет — нажми «Повторить», чтобы скачать его заново.".to_string();
    let part = lock(&app.state::<GameDownloads>().queue).part_of(id);
    let dir = part.as_ref().and_then(|part| part_dir(&app, part)).ok_or_else(gone)?;
    let target = kept_archive(&dir, part.as_ref()).unwrap_or(dir);
    if !target.exists() {
        return Err(gone());
    }
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn game_download_dismiss(app: AppHandle) -> Snapshot {
    let state = app.state::<GameDownloads>();
    lock(&state.queue).dismiss_done();
    emit(&app);
    snapshot(&app)
}
