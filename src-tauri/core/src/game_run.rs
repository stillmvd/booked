use std::collections::HashSet;
use std::time::Duration;

pub const WINDOW_WAIT: Duration = Duration::from_secs(90);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Launching,
    Running,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Launching => "launching",
            Phase::Running => "running",
        }
    }
}

pub fn step(phase: Phase, elapsed: Duration, has_window: bool, alive: bool) -> Option<Phase> {
    if !alive {
        return None;
    }
    match phase {
        Phase::Launching if has_window || elapsed >= WINDOW_WAIT => Some(Phase::Running),
        other => Some(other),
    }
}

#[derive(Clone, Copy, Debug)]
pub struct WindowInfo {
    pub pid: u32,
    pub visible: bool,
    pub owned: bool,
    pub width: i32,
    pub height: i32,
}

pub fn is_game_window(window: &WindowInfo, pids: &HashSet<u32>) -> bool {
    window.visible && !window.owned && window.width > 0 && window.height > 0 && pids.contains(&window.pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEC: Duration = Duration::from_secs(1);

    fn window(pid: u32) -> WindowInfo {
        WindowInfo { pid, visible: true, owned: false, width: 1280, height: 720 }
    }

    #[test]
    fn launching_stays_until_window_appears() {
        assert_eq!(step(Phase::Launching, 5 * SEC, false, true), Some(Phase::Launching));
        assert_eq!(step(Phase::Launching, 6 * SEC, true, true), Some(Phase::Running));
    }

    #[test]
    fn launching_without_window_turns_running_after_wait() {
        assert_eq!(step(Phase::Launching, WINDOW_WAIT - SEC, false, true), Some(Phase::Launching));
        assert_eq!(step(Phase::Launching, WINDOW_WAIT, false, true), Some(Phase::Running));
    }

    #[test]
    fn exit_before_window_ends_without_running() {
        assert_eq!(step(Phase::Launching, 2 * SEC, false, false), None);
        assert_eq!(step(Phase::Launching, 2 * SEC, true, false), None);
    }

    #[test]
    fn running_ends_only_when_no_process_alive() {
        assert_eq!(step(Phase::Running, 600 * SEC, false, true), Some(Phase::Running));
        assert_eq!(step(Phase::Running, 600 * SEC, false, false), None);
    }

    #[test]
    fn game_window_belongs_to_any_process_of_the_game() {
        let pids: HashSet<u32> = [100, 204].into_iter().collect();
        assert!(is_game_window(&window(204), &pids));
        assert!(!is_game_window(&window(300), &pids));
    }

    #[test]
    fn hidden_owned_or_empty_windows_do_not_count() {
        let pids: HashSet<u32> = [100].into_iter().collect();
        assert!(!is_game_window(&WindowInfo { visible: false, ..window(100) }, &pids));
        assert!(!is_game_window(&WindowInfo { owned: true, ..window(100) }, &pids));
        assert!(!is_game_window(&WindowInfo { width: 0, ..window(100) }, &pids));
        assert!(!is_game_window(&WindowInfo { height: 0, ..window(100) }, &pids));
    }

    #[test]
    fn phase_names_match_the_interface() {
        assert_eq!(Phase::Launching.as_str(), "launching");
        assert_eq!(Phase::Running.as_str(), "running");
    }
}
