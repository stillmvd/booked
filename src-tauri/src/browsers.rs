use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::State;
use trove_core::browsers::{self as core_browsers, Family};

use crate::db::{with_conn, Db};

#[derive(Debug, Clone)]
pub struct RegistryBrowser {
    pub name: String,
    pub exe: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileEntry {
    pub key: String,
    pub name: String,
    pub avatar_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEntry {
    pub key: String,
    pub name: String,
    pub icon_key: Option<&'static str>,
    pub family: Family,
    pub profiles: Vec<BrowserProfileEntry>,
    #[serde(skip)]
    pub exe: PathBuf,
}

fn extract_exe_path(command: &str) -> String {
    let trimmed = command.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        return match rest.find('"') {
            Some(end) => rest[..end].to_string(),
            None => rest.to_string(),
        };
    }
    if trimmed.to_lowercase().ends_with(".exe") {
        return trimmed.to_string();
    }
    trimmed.split_whitespace().next().unwrap_or("").to_string()
}

fn app_paths_display_name(exe_name: &str) -> String {
    let stem = exe_name.strip_suffix(".exe").unwrap_or(exe_name);
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(windows)]
const APP_PATHS_EXES: [&str; 8] =
    ["chrome.exe", "msedge.exe", "brave.exe", "vivaldi.exe", "firefox.exe", "opera.exe", "browser.exe", "tor.exe"];

#[cfg(windows)]
fn push_if_exists(
    found: &mut Vec<RegistryBrowser>,
    seen: &mut std::collections::HashSet<String>,
    name: String,
    exe_path: String,
) {
    let exe = PathBuf::from(&exe_path);
    if !exe.exists() {
        return;
    }
    if !seen.insert(exe_path.to_lowercase()) {
        return;
    }
    found.push(RegistryBrowser { name, exe });
}

#[cfg(windows)]
fn collect_start_menu_internet(
    root: &windows_registry::Key,
    subpath: &str,
    found: &mut Vec<RegistryBrowser>,
    seen: &mut std::collections::HashSet<String>,
) {
    let Ok(parent) = root.open(subpath) else { return };
    let Ok(names) = parent.keys() else { return };
    for name in names {
        let Ok(sub) = parent.open(&name) else { continue };
        let display_name = sub.get_string("").unwrap_or_else(|_| name.clone());
        let Ok(command_key) = sub.open(r"shell\open\command") else { continue };
        let Ok(command) = command_key.get_string("") else { continue };
        push_if_exists(found, seen, display_name, extract_exe_path(&command));
    }
}

#[cfg(windows)]
fn collect_app_path(
    root: &windows_registry::Key,
    prefix: &str,
    exe_name: &str,
    found: &mut Vec<RegistryBrowser>,
    seen: &mut std::collections::HashSet<String>,
) {
    let Ok(key) = root.open(format!(r"{prefix}\{exe_name}")) else { return };
    let Ok(exe_path) = key.get_string("") else { return };
    push_if_exists(found, seen, app_paths_display_name(exe_name), exe_path);
}

#[cfg(windows)]
pub fn enumerate() -> Vec<RegistryBrowser> {
    use windows_registry::{CURRENT_USER, LOCAL_MACHINE};

    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (root, subpath) in [
        (LOCAL_MACHINE, r"SOFTWARE\Clients\StartMenuInternet"),
        (LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Clients\StartMenuInternet"),
        (CURRENT_USER, r"SOFTWARE\Clients\StartMenuInternet"),
    ] {
        collect_start_menu_internet(root, subpath, &mut found, &mut seen);
    }

    for (root, prefix) in [
        (LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
        (LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths"),
        (CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
    ] {
        for exe_name in APP_PATHS_EXES {
            collect_app_path(root, prefix, exe_name, &mut found, &mut seen);
        }
    }

    found
}

#[cfg(not(windows))]
pub fn enumerate() -> Vec<RegistryBrowser> {
    Vec::new()
}

#[tauri::command]
pub fn browser_list() -> Vec<BrowserEntry> {
    let mut entries: Vec<BrowserEntry> = enumerate()
        .into_iter()
        .map(|b| BrowserEntry {
            key: core_browsers::browser_key(&b.name),
            icon_key: core_browsers::icon_key(&b.name, &b.exe),
            family: core_browsers::family_of(&b.name, &b.exe),
            name: b.name,
            profiles: Vec::new(),
            exe: b.exe,
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

fn build_args(family: Family, profile: Option<&str>, url: &str) -> Vec<String> {
    let mut args = Vec::new();
    match family {
        Family::Chromium => {
            if let Some(profile) = profile {
                args.push(format!("--profile-directory={profile}"));
            }
        }
        Family::Firefox => {
            if let Some(profile) = profile {
                args.push("-P".to_string());
                args.push(profile.to_string());
            }
        }
        Family::Other => {}
    }
    args.push(url.to_string());
    args
}

pub fn launch(exe: &Path, family: Family, profile: Option<&str>, url: &str) -> Result<(), String> {
    let safe_url = core_browsers::is_launchable_url(url).map_err(|e| e.to_string())?;
    let args = build_args(family, profile, &safe_url);

    let mut cmd = Command::new(exe);
    cmd.args(&args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bookmark_set_browser(
    db: State<Db>,
    id: i64,
    browser: Option<String>,
    profile: Option<String>,
    profile_name: Option<String>,
) -> Result<(), String> {
    let target = core_browsers::BrowserTarget { browser, profile, profile_name };
    with_conn(&db, |conn| core_browsers::set_target(conn, id, &target))
}

#[tauri::command]
pub fn bookmark_open_with(
    db: State<Db>,
    id: i64,
    browser: Option<String>,
    profile: Option<String>,
) -> Result<crate::bookmarks::OpenOutcome, String> {
    let url = with_conn(&db, |conn| Ok(trove_core::bookmarks::url_for_open(conn, id)))??;
    let target = core_browsers::BrowserTarget { browser, profile, profile_name: None };
    crate::bookmarks::resolve_and_open(&url, &target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_exe_path_handles_quoted_command() {
        assert_eq!(
            extract_exe_path(r#""C:\Program Files\Google\Chrome\Application\chrome.exe""#),
            r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        );
    }

    #[test]
    fn extract_exe_path_handles_bare_exe_with_no_args() {
        assert_eq!(extract_exe_path(r"C:\Program Files\Mozilla Firefox\firefox.exe"), r"C:\Program Files\Mozilla Firefox\firefox.exe");
    }

    #[test]
    fn extract_exe_path_handles_quoted_with_trailing_args() {
        assert_eq!(
            extract_exe_path(r#""C:\Program Files\Google\Chrome\Application\chrome.exe" --single-argument %1"#),
            r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        );
    }

    #[test]
    fn extract_exe_path_handles_unquoted_no_space_with_trailing_args() {
        assert_eq!(extract_exe_path(r"C:\Apps\browser.exe --flag"), r"C:\Apps\browser.exe");
    }

    #[test]
    fn app_paths_display_name_capitalizes_stem() {
        assert_eq!(app_paths_display_name("chrome.exe"), "Chrome");
        assert_eq!(app_paths_display_name("msedge.exe"), "Msedge");
    }

    #[test]
    fn build_args_chromium_with_profile_is_flag_then_url() {
        let profile = "Profile 1";
        let args = build_args(Family::Chromium, Some(profile), "https://example.com");
        assert_eq!(args, vec![format!("--profile-directory={profile}"), "https://example.com".to_string()]);
    }

    #[test]
    fn build_args_firefox_with_profile_is_flag_name_then_url() {
        let args = build_args(Family::Firefox, Some("default-release"), "https://example.com");
        assert_eq!(
            args,
            vec!["-P".to_string(), "default-release".to_string(), "https://example.com".to_string()]
        );
    }

    #[test]
    fn build_args_other_ignores_profile() {
        let args = build_args(Family::Other, Some("whatever"), "https://example.com");
        assert_eq!(args, vec!["https://example.com".to_string()]);
    }

    #[test]
    fn launch_rejects_switch_like_url_before_spawning() {
        let result = launch(Path::new("does-not-exist.exe"), Family::Chromium, None, "--load-extension=C:\\evil");
        assert!(result.is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn enumerate_is_empty_off_windows() {
        assert!(enumerate().is_empty());
    }
}
