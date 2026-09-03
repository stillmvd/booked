use serde::Serialize;
use tauri::{AppHandle, State};
use magpie_core::bookmarks::{self, DuplicateHit};
use magpie_core::browsers::{self as core_browsers, BrowserTarget, Family};
use magpie_core::images;
use magpie_core::tags;
use magpie_core::url_norm;

use crate::browsers::{self, avatars_dir_of, BrowserEntry};
use crate::db::{with_conn, with_conn_mut, Db};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOutcome {
    pub missing_kind: Option<String>,
    pub missing_name: Option<String>,
}

impl OpenOutcome {
    fn none() -> Self {
        OpenOutcome { missing_kind: None, missing_name: None }
    }
}

enum ResolvedAction {
    OpenDefault,
    Launch { exe: PathBuf, family: Family, profile: Option<String> },
}

fn decide(target: &BrowserTarget, entries: &[BrowserEntry]) -> (ResolvedAction, OpenOutcome) {
    let Some(browser_name) = target.browser.as_deref().filter(|s| !s.is_empty()) else {
        return (ResolvedAction::OpenDefault, OpenOutcome::none());
    };

    let slug = core_browsers::browser_key(browser_name);
    let Some(entry) = entries.iter().find(|e| e.key == slug) else {
        let outcome = OpenOutcome {
            missing_kind: Some("browser".to_string()),
            missing_name: Some(browser_name.to_string()),
        };
        return (ResolvedAction::OpenDefault, outcome);
    };

    match target.profile.as_deref().filter(|s| !s.is_empty()) {
        None => {
            let action = ResolvedAction::Launch { exe: entry.exe.clone(), family: entry.family, profile: None };
            (action, OpenOutcome::none())
        }
        Some(profile_value) => {
            if entry.profiles.iter().any(|p| p.key == profile_value) {
                let action = ResolvedAction::Launch {
                    exe: entry.exe.clone(),
                    family: entry.family,
                    profile: Some(profile_value.to_string()),
                };
                (action, OpenOutcome::none())
            } else {
                let missing_name = target.profile_name.clone().unwrap_or_else(|| profile_value.to_string());
                let outcome = OpenOutcome { missing_kind: Some("profile".to_string()), missing_name: Some(missing_name) };
                (ResolvedAction::OpenDefault, outcome)
            }
        }
    }
}

pub(crate) fn resolve_and_open(avatars_dir: &Path, url: &str, target: &BrowserTarget) -> Result<OpenOutcome, String> {
    let safe_url = core_browsers::is_launchable_url(url).map_err(|e| e.to_string())?;
    let entries = browsers::list_with_profiles(avatars_dir);
    let (action, outcome) = decide(target, &entries);
    match action {
        ResolvedAction::OpenDefault => {
            tauri_plugin_opener::open_url(&safe_url, None::<&str>).map_err(|e| e.to_string())?;
        }
        ResolvedAction::Launch { exe, family, profile } => {
            browsers::launch(&exe, family, profile.as_deref(), &safe_url)?;
        }
    }
    Ok(outcome)
}

#[tauri::command]
pub fn bookmark_open(app: AppHandle, db: State<Db>, id: i64) -> Result<OpenOutcome, String> {
    let url = with_conn(&db, |conn| Ok(bookmarks::url_for_open(conn, id)))??;
    let target = with_conn(&db, |conn| core_browsers::target_for(conn, id))?;
    resolve_and_open(&avatars_dir_of(&app), &url, &target)
}

#[tauri::command]
pub fn bookmark_find_duplicate(db: State<Db>, url: String) -> Result<Option<DuplicateHit>, String> {
    let normalized = match url_norm::parse(&url) {
        Ok(parsed) => parsed.normalized,
        Err(_) => return Ok(None),
    };
    with_conn(&db, |conn| bookmarks::find_by_normalized(conn, &normalized))
}

#[tauri::command]
pub fn bookmark_create(
    db: State<Db>,
    folder_id: Option<i64>,
    title: String,
    url: String,
    description: Option<String>,
    image: Option<String>,
) -> Result<i64, String> {
    if let Some(filename) = &image {
        if !images::is_valid_image_filename(filename) {
            return Err("недопустимое имя файла картинки".into());
        }
    }
    let parsed = url_norm::parse(&url).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() { bookmarks::host_of(&parsed) } else { title };
    with_conn(&db, |conn| {
        bookmarks::create(conn, folder_id, &title, &parsed, description.as_deref(), image.as_deref())
    })
}

#[tauri::command]
pub fn bookmark_update(
    db: State<Db>,
    id: i64,
    folder_id: Option<i64>,
    title: String,
    url: String,
    description: Option<String>,
    image: Option<String>,
) -> Result<(), String> {
    if let Some(filename) = &image {
        if !images::is_valid_image_filename(filename) {
            return Err("недопустимое имя файла картинки".into());
        }
    }
    let parsed = url_norm::parse(&url).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() { bookmarks::host_of(&parsed) } else { title };
    with_conn(&db, |conn| {
        bookmarks::update(conn, id, folder_id, &title, &parsed, description.as_deref(), image.as_deref())
    })
}

#[tauri::command]
pub fn bookmark_set_tags(db: State<Db>, id: i64, tags: Vec<String>) -> Result<(), String> {
    with_conn_mut(&db, |conn| tags::set_for_bookmark(conn, id, &tags))
}

#[tauri::command]
pub fn bookmark_delete(db: State<Db>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| bookmarks::delete(conn, id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browsers::BrowserProfileEntry;
    use rusqlite::Connection;

    fn ghost_target() -> BrowserTarget {
        BrowserTarget {
            browser: Some("Ghost Browser".to_string()),
            profile: None,
            profile_name: None,
        }
    }

    #[test]
    fn decide_with_no_target_opens_default_with_empty_outcome() {
        let (action, outcome) = decide(&BrowserTarget::default(), &[]);
        assert!(matches!(action, ResolvedAction::OpenDefault));
        assert_eq!(outcome, OpenOutcome::none());
    }

    #[test]
    fn decide_with_missing_browser_falls_back_and_names_it() {
        let (action, outcome) = decide(&ghost_target(), &[]);
        assert!(matches!(action, ResolvedAction::OpenDefault));
        assert_eq!(outcome.missing_kind.as_deref(), Some("browser"));
        assert_eq!(outcome.missing_name.as_deref(), Some("Ghost Browser"));
    }

    #[test]
    fn decide_with_missing_profile_falls_back_and_names_it() {
        let entry = BrowserEntry {
            key: "google-chrome".to_string(),
            name: "Google Chrome".to_string(),
            icon_key: Some("chrome"),
            family: Family::Chromium,
            profiles: Vec::new(),
            exe: PathBuf::from(r"C:\chrome.exe"),
        };
        let target = BrowserTarget {
            browser: Some("Google Chrome".to_string()),
            profile: Some("Profile 1".to_string()),
            profile_name: Some("Работа".to_string()),
        };
        let (action, outcome) = decide(&target, &[entry]);
        assert!(matches!(action, ResolvedAction::OpenDefault));
        assert_eq!(outcome.missing_kind.as_deref(), Some("profile"));
        assert_eq!(outcome.missing_name.as_deref(), Some("Работа"));
    }

    #[test]
    fn decide_with_found_browser_and_no_profile_launches() {
        let entry = BrowserEntry {
            key: "google-chrome".to_string(),
            name: "Google Chrome".to_string(),
            icon_key: Some("chrome"),
            family: Family::Chromium,
            profiles: Vec::new(),
            exe: PathBuf::from(r"C:\chrome.exe"),
        };
        let target = BrowserTarget {
            browser: Some("Google Chrome".to_string()),
            profile: None,
            profile_name: None,
        };
        let (action, outcome) = decide(&target, &[entry]);
        assert_eq!(outcome, OpenOutcome::none());
        match action {
            ResolvedAction::Launch { exe, family, profile } => {
                assert_eq!(exe, PathBuf::from(r"C:\chrome.exe"));
                assert_eq!(family, Family::Chromium);
                assert_eq!(profile, None);
            }
            ResolvedAction::OpenDefault => panic!("expected launch"),
        }
    }

    #[test]
    fn decide_with_found_browser_and_found_profile_launches_with_profile_key_not_display_name() {
        let entry = BrowserEntry {
            key: "google-chrome".to_string(),
            name: "Google Chrome".to_string(),
            icon_key: Some("chrome"),
            family: Family::Chromium,
            profiles: vec![BrowserProfileEntry {
                key: "Profile 1".to_string(),
                name: "Работа".to_string(),
                avatar_file: None,
            }],
            exe: PathBuf::from(r"C:\chrome.exe"),
        };
        let target = BrowserTarget {
            browser: Some("Google Chrome".to_string()),
            profile: Some("Profile 1".to_string()),
            profile_name: Some("Работа".to_string()),
        };
        let (action, outcome) = decide(&target, &[entry]);
        assert_eq!(outcome, OpenOutcome::none());
        match action {
            ResolvedAction::Launch { exe, family, profile } => {
                assert_eq!(exe, PathBuf::from(r"C:\chrome.exe"));
                assert_eq!(family, Family::Chromium);
                assert_eq!(profile.as_deref(), Some("Profile 1"));
            }
            ResolvedAction::OpenDefault => panic!("expected launch"),
        }
    }

    #[test]
    fn missing_target_does_not_mutate_stored_assignment() {
        let conn = Connection::open_in_memory().unwrap();
        magpie_core::db::migrate(&conn).unwrap();
        let parsed = url_norm::parse("https://example.test/ghost").unwrap();
        let id = bookmarks::create(&conn, None, "Ghost", &parsed, None, None).unwrap();
        let ghost = ghost_target();
        core_browsers::set_target(&conn, id, &ghost).unwrap();

        let before = core_browsers::target_for(&conn, id).unwrap();
        let (_action, outcome) = decide(&before, &[]);
        assert_eq!(outcome.missing_kind.as_deref(), Some("browser"));

        let after = core_browsers::target_for(&conn, id).unwrap();
        assert_eq!(before, after);
    }
}
