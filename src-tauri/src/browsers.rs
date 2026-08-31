use std::fs;
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

fn read_chromium_profiles(root: &Path) -> Vec<BrowserProfileEntry> {
    let Ok(json) = fs::read_to_string(root.join("Local State")) else { return Vec::new() };
    core_browsers::parse_local_state(&json)
        .into_iter()
        .filter(|p| root.join(&p.dir).is_dir())
        .map(|p| BrowserProfileEntry { key: p.dir, name: p.name, avatar_file: None })
        .collect()
}

fn read_firefox_profiles(ini_path: &Path) -> Vec<BrowserProfileEntry> {
    let Ok(text) = fs::read_to_string(ini_path) else { return Vec::new() };
    let parsed = core_browsers::parse_profiles_ini(&text);
    let base_dir = ini_path.parent().unwrap_or_else(|| Path::new(""));
    let existing: Vec<_> = parsed
        .profiles
        .into_iter()
        .filter(|p| {
            let path = if p.is_relative { base_dir.join(&p.path) } else { PathBuf::from(&p.path) };
            path.is_dir()
        })
        .collect();
    core_browsers::order_firefox(existing, parsed.install_default.as_deref())
        .into_iter()
        .map(|p| BrowserProfileEntry { key: p.name.clone(), name: p.name, avatar_file: None })
        .collect()
}

fn read_profiles(icon_key: Option<&'static str>) -> Vec<BrowserProfileEntry> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
    match core_browsers::profile_source(icon_key, &local, &roaming) {
        core_browsers::ProfileSource::ChromiumUserData(root) => read_chromium_profiles(&root),
        core_browsers::ProfileSource::FirefoxIni(ini_path) => read_firefox_profiles(&ini_path),
        core_browsers::ProfileSource::None => Vec::new(),
    }
}

#[tauri::command]
pub fn browser_list() -> Vec<BrowserEntry> {
    let mut entries: Vec<BrowserEntry> = enumerate()
        .into_iter()
        .map(|b| {
            let icon_key = core_browsers::icon_key(&b.name, &b.exe);
            BrowserEntry {
                key: core_browsers::browser_key(&b.name),
                icon_key,
                family: core_browsers::family_of(&b.name, &b.exe),
                profiles: read_profiles(icon_key),
                name: b.name,
                exe: b.exe,
            }
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

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("trove-browsers-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_chromium_profiles_drops_directory_that_does_not_exist() {
        let root = scratch_dir("chromium-missing-dir");
        fs::create_dir_all(root.join("Default")).unwrap();
        let local_state = r#"{
            "profile": {
                "profiles_order": ["Default", "Profile 1"],
                "info_cache": {
                    "Default": { "name": "stillmvd" },
                    "Profile 1": { "name": "Работа" }
                }
            }
        }"#;
        fs::write(root.join("Local State"), local_state).unwrap();

        let profiles = read_chromium_profiles(&root);
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].key, "Default");
        assert_eq!(profiles[0].name, "stillmvd");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_chromium_profiles_of_missing_root_is_empty_not_error() {
        let root = std::env::temp_dir().join("trove-browsers-test-root-does-not-exist-at-all");
        assert!(read_chromium_profiles(&root).is_empty());
    }

    #[test]
    fn read_firefox_profiles_orders_install_default_first_and_drops_missing_dirs() {
        let root = scratch_dir("firefox-order");
        fs::create_dir_all(root.join("Profiles/aaa.default-release")).unwrap();
        let ini = "[Profile0]\n\
                   Name=default-release\n\
                   IsRelative=1\n\
                   Path=Profiles/aaa.default-release\n\
                   \n\
                   [Profile1]\n\
                   Name=default\n\
                   IsRelative=1\n\
                   Path=Profiles/missing.default\n\
                   Default=1\n\
                   \n\
                   [Install1234]\n\
                   Default=Profiles/aaa.default-release\n";
        let ini_path = root.join("profiles.ini");
        fs::write(&ini_path, ini).unwrap();

        let profiles = read_firefox_profiles(&ini_path);
        assert_eq!(profiles.len(), 1, "missing profile dir must be dropped");
        assert_eq!(profiles[0].key, "default-release");
        assert_eq!(profiles[0].name, "default-release");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_profiles_of_unknown_icon_key_is_empty() {
        assert!(read_profiles(None).is_empty());
    }
}
