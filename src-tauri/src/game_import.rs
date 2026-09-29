use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use booked_core::game_import::{archive_stem, free_name, inner_path, is_junk, safe_name, shared_top};
use booked_core::games;

use crate::db::{with_conn, Db};
use crate::games::{folder_size, is_within, library_now, stored_root, GAMES_CHANGED_EVENT};
use crate::recycle;

const IMPORT_PROGRESS_EVENT: &str = "games:import-progress";
const DROPPED_EVENT: &str = "games:dropped";
const TEMP_PREFIX: &str = ".booked-import-";
const REPORT_GAP: Duration = Duration::from_millis(120);
const CHUNK: usize = 1 << 18;

#[derive(Default)]
pub struct GamesImport {
    running: AtomicBool,
    cancel: AtomicBool,
}

#[derive(Clone, Serialize)]
struct ImportProgress {
    done: u64,
    total: u64,
}

enum Stop {
    Cancelled,
    Failed(String),
}

impl From<String> for Stop {
    fn from(text: String) -> Self {
        Stop::Failed(text)
    }
}

struct Progress<'a> {
    app: &'a AppHandle,
    cancel: &'a AtomicBool,
    done: u64,
    total: u64,
    last: Instant,
}

impl Progress<'_> {
    fn advance(&mut self, bytes: u64) -> Result<(), Stop> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(Stop::Cancelled);
        }
        self.done = self.done.saturating_add(bytes);
        if self.last.elapsed() >= REPORT_GAP {
            self.last = Instant::now();
            self.emit();
        }
        Ok(())
    }

    fn emit(&self) {
        let _ = self.app.emit(IMPORT_PROGRESS_EVENT, ImportProgress { done: self.done.min(self.total), total: self.total });
    }
}

fn write_failed(err: &io::Error) -> Stop {
    if err.kind() == io::ErrorKind::StorageFull {
        return Stop::Failed("Не хватило места на диске с играми.".to_string());
    }
    Stop::Failed("Не удалось записать файлы игры в папку с играми.".to_string())
}

fn pour(from: &mut impl Read, target: &Path, progress: &mut Progress) -> Result<(), Stop> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| write_failed(&err))?;
    }
    let mut out = File::create(target).map_err(|err| write_failed(&err))?;
    let mut buffer = vec![0u8; CHUNK];
    loop {
        let read = from
            .read(&mut buffer)
            .map_err(|_| Stop::Failed("Архив повреждён — скачайте его заново.".to_string()))?;
        if read == 0 {
            return Ok(());
        }
        out.write_all(&buffer[..read]).map_err(|err| write_failed(&err))?;
        progress.advance(read as u64)?;
    }
}

fn unpack(archive: &Path, temp: &Path, progress: &mut Progress) -> Result<String, Stop> {
    let file = File::open(archive).map_err(|_| "Не удалось открыть архив — возможно, он ещё скачивается.".to_string())?;
    let mut zip = zip::ZipArchive::new(io::BufReader::new(file))
        .map_err(|_| "Файл не похож на архив .zip или повреждён.".to_string())?;

    let mut entries = Vec::new();
    for index in 0..zip.len() {
        let Ok(entry) = zip.by_index_raw(index) else { continue };
        let Some(path) = entry.enclosed_name() else { continue };
        let mut name = path.to_string_lossy().replace('\\', "/");
        if entry.is_dir() {
            name.push('/');
        }
        if !is_junk(&name) {
            progress.total = progress.total.saturating_add(entry.size());
        }
        entries.push((index, name, entry.is_dir()));
    }
    let names: Vec<String> = entries.iter().map(|(_, name, _)| name.clone()).collect();
    let top = shared_top(&names);
    progress.emit();

    for (index, name, is_dir) in &entries {
        if is_junk(name) {
            continue;
        }
        let Some(rel) = inner_path(name, top.as_deref()) else { continue };
        let target = temp.join(&rel);
        if !target.starts_with(temp) {
            continue;
        }
        if *is_dir {
            fs::create_dir_all(&target).map_err(|err| write_failed(&err))?;
            continue;
        }
        let mut entry = zip.by_index(*index).map_err(|_| {
            "Архив защищён паролем или сжат способом, который Booked не умеет. Распакуйте его сами и перетащите папку."
                .to_string()
        })?;
        pour(&mut entry, &target, progress)?;
    }

    let stem = archive.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    Ok(top.unwrap_or_else(|| archive_stem(&stem).to_string()))
}

fn tar_command() -> std::process::Command {
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let mut command = std::process::Command::new(system.join("System32").join("tar.exe"));
    command.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn tar_total(archive: &Path) -> u64 {
    let Ok(out) = tar_command().arg("-tvf").arg(archive).stderr(std::process::Stdio::null()).output() else {
        return 0;
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| line.split_whitespace().nth(4)?.parse::<u64>().ok())
        .sum()
}

fn unpack_tar(archive: &Path, temp: &Path, progress: &mut Progress) -> Result<String, Stop> {
    let broken = || {
        Stop::Failed(
            "Не удалось распаковать архив — он повреждён или защищён паролем. Распакуйте его сами и перетащите папку."
                .to_string(),
        )
    };
    let raw = temp.with_file_name(format!("{}-raw", temp.file_name().unwrap_or_default().to_string_lossy()));
    let _ = fs::remove_dir_all(&raw);
    fs::create_dir_all(&raw).map_err(|err| write_failed(&err))?;
    progress.total = tar_total(archive);
    progress.emit();

    let mut child = tar_command()
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(&raw)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "Эта версия Windows не умеет распаковывать такие архивы — распакуйте его сами и перетащите папку.".to_string())?;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| broken())? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(300));
        let grown = folder_size(&raw).max(0) as u64;
        let step = grown.saturating_sub(progress.done);
        if let Err(stop) = progress.advance(step) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_dir_all(&raw);
            return Err(stop);
        }
    };
    if !status.success() {
        let _ = fs::remove_dir_all(&raw);
        return Err(broken());
    }

    let mut names = Vec::new();
    for entry in fs::read_dir(&raw).map_err(|_| broken())?.flatten() {
        let mut name = entry.file_name().to_string_lossy().to_string();
        if is_junk(&name) {
            let _ = fs::remove_dir_all(entry.path()).or_else(|_| fs::remove_file(entry.path()));
            continue;
        }
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            name.push('/');
        }
        names.push(name);
    }
    let moved = match shared_top(&names) {
        Some(top) => {
            let inner = raw.join(&top);
            for name in names.iter().filter(|name| !name.ends_with('/')) {
                let _ = fs::rename(raw.join(name), inner.join(name));
            }
            let result = fs::rename(&inner, temp);
            let _ = fs::remove_dir_all(&raw);
            result.map(|_| top)
        }
        None => {
            let stem = archive.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
            fs::rename(&raw, temp).map(|_| archive_stem(&stem).to_string())
        }
    };
    moved.map_err(|_| Stop::Failed("Не удалось переименовать распакованную папку.".to_string()))
}

fn copy_tree(from: &Path, to: &Path, progress: &mut Progress) -> Result<(), Stop> {
    fs::create_dir_all(to).map_err(|err| write_failed(&err))?;
    let entries = fs::read_dir(from).map_err(|_| "Не удалось прочитать папку с игрой.".to_string())?;
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target, progress)?;
        } else if kind.is_file() {
            let mut source =
                File::open(entry.path()).map_err(|_| "Не удалось прочитать папку с игрой.".to_string())?;
            pour(&mut source, &target, progress)?;
        }
    }
    Ok(())
}

fn clear_leftovers(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(TEMP_PREFIX) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn place(root: &Path, temp: &Path, wanted: &str) -> Result<PathBuf, Stop> {
    let name = free_name(&safe_name(wanted), |candidate| root.join(candidate).exists());
    let target = root.join(name);
    fs::rename(temp, &target).map_err(|_| "Не удалось переименовать распакованную папку.".to_string())?;
    Ok(target)
}

fn bring(root: &Path, source: &Path, progress: &mut Progress) -> Result<PathBuf, Stop> {
    let temp = root.join(format!("{TEMP_PREFIX}{}", std::process::id()));
    let _ = fs::remove_dir_all(&temp);

    if source.is_dir() {
        if is_within(root, source) || root.canonicalize().ok() == source.canonicalize().ok() {
            return Err("Эта папка уже лежит в папке с играми — Booked её видит.".to_string().into());
        }
        if is_within(source, root) {
            return Err("Внутри этой папки лежит сама папка с играми — выберите папку одной игры.".to_string().into());
        }
        if recycle::folder_is_busy(source) {
            return Err("Папка с игрой занята — закройте игру и повторите.".to_string().into());
        }
        let wanted = source.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
        let name = free_name(&safe_name(&wanted), |candidate| root.join(candidate).exists());
        let target = root.join(name);
        progress.advance(0)?;
        if fs::rename(source, &target).is_ok() {
            return Ok(target);
        }
        progress.total = folder_size(source).max(0) as u64;
        progress.emit();
        let copied = copy_tree(source, &temp, progress)
            .and_then(|_| progress.advance(0))
            .and_then(|_| place(root, &temp, &wanted));
        if copied.is_err() {
            let _ = fs::remove_dir_all(&temp);
        } else {
            recycle::to_recycle_bin(source);
        }
        return copied;
    }

    let ext = source.extension().map(|ext| ext.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !source.is_file() || !["zip", "rar", "7z"].contains(&ext.as_str()) {
        return Err("Добавить можно папку с игрой или архив .zip, .rar или .7z.".to_string().into());
    }
    let unpacked = if ext == "zip" {
        fs::create_dir_all(&temp).map_err(|err| write_failed(&err))?;
        unpack(source, &temp, progress)
    } else {
        unpack_tar(source, &temp, progress)
    };
    let placed = unpacked
        .and_then(|wanted| progress.advance(0).map(|_| wanted))
        .and_then(|wanted| place(root, &temp, &wanted));
    if placed.is_err() {
        let _ = fs::remove_dir_all(&temp);
    } else {
        recycle::to_recycle_bin(source);
    }
    placed
}

fn run(app: &AppHandle, source: &Path, cancel: &AtomicBool) -> Result<i64, String> {
    let db = app.state::<Db>();
    let root = with_conn(&db, stored_root)?
        .map(PathBuf::from)
        .filter(|root| root.is_dir())
        .ok_or_else(|| "Папка с играми не выбрана или недоступна.".to_string())?;
    if !source.exists() {
        return Err("Такого файла или папки больше нет.".to_string());
    }
    clear_leftovers(&root);

    let mut progress = Progress { app, cancel, done: 0, total: 0, last: Instant::now() };
    let placed = match bring(&root, source, &mut progress) {
        Ok(path) => path,
        Err(Stop::Cancelled) => return Err("Добавление отменено.".to_string()),
        Err(Stop::Failed(text)) => return Err(text),
    };
    progress.done = progress.total;
    progress.emit();

    library_now(&db)?;
    let found = with_conn(&db, games::list)?
        .into_iter()
        .find(|game| game.folder_path.as_deref().is_some_and(|path| Path::new(path) == placed))
        .map(|game| game.id);
    if let (Some(id), true) = (found, source.is_file()) {
        let name = source.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
        if let Some(version) = games::parse_folder_name(archive_stem(&name)).version {
            with_conn(&db, |conn| games::fill_folder_version(conn, id, &version))?;
        }
    }
    let _ = app.emit(GAMES_CHANGED_EVENT, ());
    found.ok_or_else(|| "Папка добавлена, но карточка не появилась — нажмите F5.".to_string())
}

#[tauri::command]
pub async fn game_import(app: AppHandle, path: String) -> Result<i64, String> {
    let state = app.state::<GamesImport>();
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Уже добавляется другая игра — дождитесь конца.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let handle = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<GamesImport>();
        run(&handle, &PathBuf::from(path.replace('/', "\\")), &state.cancel)
    })
    .await
    .map_err(|_| "Не удалось добавить игру.".to_string())
    .and_then(|result| result);
    app.state::<GamesImport>().running.store(false, Ordering::SeqCst);
    outcome
}

#[tauri::command]
pub fn game_import_cancel(state: State<GamesImport>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg(windows)]
pub fn setup_drop(app: &AppHandle) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows::core::{Interface, PWSTR};

    let Some(window) = app.get_webview_window("main") else { return };
    let emitter = app.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args.and_then(|args| args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>().ok()) else {
                return Ok(());
            };
            let Ok(objects) = args.AdditionalObjects() else { return Ok(()) };
            let mut count = 0;
            objects.Count(&mut count)?;
            let mut paths = Vec::new();
            for index in 0..count {
                let Ok(item) = objects.GetValueAtIndex(index) else { continue };
                let Ok(file) = item.cast::<ICoreWebView2File>() else { continue };
                let mut raw = PWSTR::null();
                file.Path(&mut raw)?;
                paths.push(take_pwstr(raw));
            }
            if !paths.is_empty() {
                let _ = emitter.emit(DROPPED_EVENT, paths);
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}
