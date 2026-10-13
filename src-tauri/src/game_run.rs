use std::collections::{HashMap, HashSet};
use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, RECT};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
    QueryInformationJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
};
use windows_core::{BOOL, PCWSTR};

use booked_core::game_run::{self, Phase, WindowInfo};

pub const GAMES_RUN_EVENT: &str = "games:run";
const LAUNCH_POLL: Duration = Duration::from_millis(250);
const RUN_POLL: Duration = Duration::from_secs(1);
const MAX_PIDS: usize = 256;

#[derive(Clone, Copy)]
struct Run {
    phase: Phase,
    started_at: i64,
}

#[derive(Default)]
pub struct GameRuns(Mutex<HashMap<i64, Run>>);

impl GameRuns {
    pub fn contains(&self, id: i64) -> bool {
        self.0.lock().map(|runs| runs.contains_key(&id)).unwrap_or(false)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    id: i64,
    phase: Option<&'static str>,
    started_at: i64,
}

#[tauri::command]
pub fn games_running(runs: State<GameRuns>) -> Vec<RunState> {
    runs.0
        .lock()
        .map(|runs| {
            runs.iter()
                .map(|(&id, run)| RunState { id, phase: Some(run.phase.as_str()), started_at: run.started_at })
                .collect()
        })
        .unwrap_or_default()
}

struct Job(HANDLE);

unsafe impl Send for Job {}

impl Drop for Job {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

enum Tracker {
    Job(Job, Child),
    Single(Child),
}

#[repr(C)]
struct PidList {
    assigned: u32,
    listed: u32,
    ids: [usize; MAX_PIDS],
}

impl Tracker {
    fn new(child: Child) -> Self {
        let job = match unsafe { CreateJobObjectW(None, PCWSTR::null()) } {
            Ok(handle) => Job(handle),
            Err(_) => return Tracker::Single(child),
        };
        let process = HANDLE(child.as_raw_handle());
        match unsafe { AssignProcessToJobObject(job.0, process) } {
            Ok(()) => Tracker::Job(job, child),
            Err(_) => Tracker::Single(child),
        }
    }

    fn alive(&mut self) -> bool {
        match self {
            Tracker::Job(job, _) => {
                let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
                let ok = unsafe {
                    QueryInformationJobObject(
                        Some(job.0),
                        JobObjectBasicAccountingInformation,
                        (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                        size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                        None,
                    )
                };
                ok.is_err() || info.ActiveProcesses > 0
            }
            Tracker::Single(child) => matches!(child.try_wait(), Ok(None)),
        }
    }

    fn pids(&self) -> HashSet<u32> {
        match self {
            Tracker::Job(job, child) => {
                let mut list = Box::new(PidList { assigned: 0, listed: 0, ids: [0; MAX_PIDS] });
                let ok = unsafe {
                    QueryInformationJobObject(
                        Some(job.0),
                        JobObjectBasicProcessIdList,
                        (&mut *list as *mut PidList).cast(),
                        size_of::<PidList>() as u32,
                        None,
                    )
                };
                if ok.is_err() {
                    return HashSet::from([child.id()]);
                }
                let listed = (list.listed as usize).min(MAX_PIDS);
                list.ids[..listed].iter().map(|&pid| pid as u32).collect()
            }
            Tracker::Single(child) => HashSet::from([child.id()]),
        }
    }
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowInfo>);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let mut rect = RECT::default();
    let sized = GetWindowRect(hwnd, &mut rect).is_ok();
    windows.push(WindowInfo {
        pid,
        visible: IsWindowVisible(hwnd).as_bool(),
        owned: GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid()),
        width: if sized { rect.right - rect.left } else { 0 },
        height: if sized { rect.bottom - rect.top } else { 0 },
    });
    BOOL(1)
}

fn has_window(pids: &HashSet<u32>) -> bool {
    let mut windows: Vec<WindowInfo> = Vec::new();
    let _ = unsafe { EnumWindows(Some(collect_window), LPARAM(&mut windows as *mut Vec<WindowInfo> as isize)) };
    windows.iter().any(|window| game_run::is_game_window(window, pids))
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn publish(app: &AppHandle, id: i64, run: Option<Run>) {
    let runs = app.state::<GameRuns>();
    let Ok(mut map) = runs.0.lock() else { return };
    let started_at = match run {
        Some(run) => {
            map.insert(id, run);
            run.started_at
        }
        None => map.remove(&id).map(|run| run.started_at).unwrap_or(0),
    };
    let _ = app.emit(GAMES_RUN_EVENT, RunState { id, phase: run.map(|run| run.phase.as_str()), started_at });
}

pub fn watch(app: &AppHandle, id: i64, child: Child) {
    let mut tracker = Tracker::new(child);
    let started_at = now_ms();
    publish(app, id, Some(Run { phase: Phase::Launching, started_at }));
    let app = app.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        let mut phase = Phase::Launching;
        loop {
            let alive = tracker.alive();
            let window = phase == Phase::Launching && alive && has_window(&tracker.pids());
            match game_run::step(phase, start.elapsed(), window, alive) {
                None => {
                    publish(&app, id, None);
                    return;
                }
                Some(next) if next != phase => {
                    phase = next;
                    publish(&app, id, Some(Run { phase, started_at }));
                }
                Some(_) => {}
            }
            std::thread::sleep(if phase == Phase::Launching { LAUNCH_POLL } else { RUN_POLL });
        }
    });
}
