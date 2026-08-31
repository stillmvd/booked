use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::Path;
use url::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum LaunchDenied {
    Empty,
    SwitchLike,
    Malformed,
    Scheme,
    NoHost,
}

impl std::fmt::Display for LaunchDenied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LaunchDenied::Empty => write!(f, "адрес не может быть пустым"),
            LaunchDenied::SwitchLike => write!(f, "адрес не может начинаться с дефиса"),
            LaunchDenied::Malformed => write!(f, "не удалось разобрать адрес"),
            LaunchDenied::Scheme => write!(f, "поддерживаются только http и https"),
            LaunchDenied::NoHost => write!(f, "в адресе не указан хост"),
        }
    }
}

pub fn is_launchable_url(raw: &str) -> Result<String, LaunchDenied> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(LaunchDenied::Empty);
    }
    if trimmed.starts_with('-') {
        return Err(LaunchDenied::SwitchLike);
    }
    let parsed = match Url::parse(trimmed) {
        Ok(parsed) => parsed,
        Err(url::ParseError::EmptyHost) => return Err(LaunchDenied::NoHost),
        Err(_) => return Err(LaunchDenied::Malformed),
    };
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(LaunchDenied::Scheme);
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err(LaunchDenied::NoHost);
    }
    Ok(parsed.as_str().to_string())
}

pub fn browser_key(display_name: &str) -> String {
    display_name
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Chromium,
    Firefox,
    Other,
}

fn exe_file_name_lower(exe: &Path) -> String {
    exe.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

pub fn family_of(_display_name: &str, exe: &Path) -> Family {
    match exe_file_name_lower(exe).as_str() {
        "chrome.exe" | "msedge.exe" | "brave.exe" | "vivaldi.exe" | "opera.exe" | "browser.exe" => Family::Chromium,
        "firefox.exe" => Family::Firefox,
        _ => Family::Other,
    }
}

pub fn icon_key(display_name: &str, exe: &Path) -> Option<&'static str> {
    let path_lower = exe.to_string_lossy().to_lowercase();
    let name_lower = display_name.to_lowercase();
    if path_lower.contains("yandex") || name_lower.contains("yandex") || name_lower.contains("яндекс") {
        return Some("yandex");
    }
    if path_lower.contains("tor browser") || name_lower.contains("tor browser") {
        return Some("tor");
    }
    match exe_file_name_lower(exe).as_str() {
        "chrome.exe" => Some("chrome"),
        "firefox.exe" => Some("firefox"),
        "msedge.exe" => Some("edge"),
        "brave.exe" => Some("brave"),
        "vivaldi.exe" => Some("vivaldi"),
        "opera.exe" => Some("opera"),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChromiumProfile {
    pub dir: String,
    pub name: String,
    pub gaia_picture: Option<String>,
}

pub fn parse_local_state(json: &str) -> Vec<ChromiumProfile> {
    let root: JsonValue = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(info_cache) = root.get("profile").and_then(|p| p.get("info_cache")).and_then(|v| v.as_object())
    else {
        return Vec::new();
    };

    let mut order: Vec<String> = root
        .get("profile")
        .and_then(|p| p.get("profiles_order"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    order.retain(|dir| info_cache.contains_key(dir));

    let mut remaining: Vec<String> = info_cache.keys().filter(|k| !order.contains(k)).cloned().collect();
    remaining.sort();
    order.extend(remaining);

    order
        .into_iter()
        .filter_map(|dir| {
            let meta = info_cache.get(&dir)?;
            let name = meta.get("name").and_then(|v| v.as_str()).unwrap_or(&dir).to_string();
            let gaia_picture = meta.get("gaia_picture_file_name").and_then(|v| v.as_str()).map(|s| s.to_string());
            Some(ChromiumProfile { dir, name, gaia_picture })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct FirefoxProfile {
    pub name: String,
    pub path: String,
    pub is_relative: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct FirefoxProfiles {
    pub profiles: Vec<FirefoxProfile>,
    pub install_default: Option<String>,
}

fn is_numbered_profile_section(name: &str) -> bool {
    name.strip_prefix("Profile").is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
}

pub fn parse_profiles_ini(text: &str) -> FirefoxProfiles {
    let mut sections: Vec<(String, HashMap<String, String>)> = Vec::new();
    let mut current: Option<(String, HashMap<String, String>)> = None;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            current = Some((name.to_string(), HashMap::new()));
            continue;
        }
        if let Some((_, map)) = current.as_mut() {
            if let Some((key, value)) = line.split_once('=') {
                map.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }
    if let Some(section) = current.take() {
        sections.push(section);
    }

    let profiles: Vec<FirefoxProfile> = sections
        .iter()
        .filter(|(name, _)| is_numbered_profile_section(name))
        .filter_map(|(_, map)| {
            let name = map.get("Name")?.clone();
            let path = map.get("Path")?.clone();
            let is_relative = map.get("IsRelative").map(|v| v == "1").unwrap_or(true);
            Some(FirefoxProfile { name, path, is_relative })
        })
        .collect();

    let install_default_path = sections
        .iter()
        .find(|(name, _)| name.starts_with("Install"))
        .and_then(|(_, map)| map.get("Default").cloned());

    let install_default =
        install_default_path.and_then(|path| profiles.iter().find(|p| p.path == path).map(|p| p.name.clone()));

    FirefoxProfiles { profiles, install_default }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTarget {
    pub browser: Option<String>,
    pub profile: Option<String>,
    pub profile_name: Option<String>,
}

pub fn target_for(conn: &Connection, id: i64) -> rusqlite::Result<BrowserTarget> {
    conn.query_row(
        "SELECT target_browser, target_profile, target_profile_name FROM bookmarks WHERE id = ?1",
        params![id],
        |row| {
            Ok(BrowserTarget {
                browser: row.get(0)?,
                profile: row.get(1)?,
                profile_name: row.get(2)?,
            })
        },
    )
}

pub fn set_target(conn: &Connection, id: i64, target: &BrowserTarget) -> rusqlite::Result<()> {
    let browser = target.browser.as_deref().filter(|s| !s.is_empty());
    let (profile, profile_name) = if browser.is_some() {
        (target.profile.as_deref(), target.profile_name.as_deref())
    } else {
        (None, None)
    };
    conn.execute(
        "UPDATE bookmarks SET target_browser = ?1, target_profile = ?2, target_profile_name = ?3 WHERE id = ?4",
        params![browser, profile, profile_name, id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::url_norm;

    #[test]
    fn accepts_http_and_https() {
        assert_eq!(is_launchable_url("https://example.com/page").unwrap(), "https://example.com/page");
        assert_eq!(is_launchable_url("http://8.8.8.8/").unwrap(), "http://8.8.8.8/");
    }

    #[test]
    fn rejects_switch_like_forms() {
        for input in ["--load-extension=C:\\evil", "--remote-debugging-port=9222", "-P", "--headless"] {
            assert_eq!(is_launchable_url(input), Err(LaunchDenied::SwitchLike), "input: {input}");
        }
    }

    #[test]
    fn rejects_switch_like_with_leading_whitespace() {
        assert_eq!(is_launchable_url("   --headless"), Err(LaunchDenied::SwitchLike));
    }

    #[test]
    fn rejects_foreign_schemes() {
        for input in [
            "file:///C:/Windows/system32",
            "javascript:alert(1)",
            "chrome://settings",
            "data:text/html,x",
        ] {
            assert_eq!(is_launchable_url(input), Err(LaunchDenied::Scheme), "input: {input}");
        }
    }

    #[test]
    fn rejects_empty_and_blank_input() {
        assert_eq!(is_launchable_url(""), Err(LaunchDenied::Empty));
        assert_eq!(is_launchable_url("   "), Err(LaunchDenied::Empty));
    }

    #[test]
    fn rejects_hostless_url() {
        assert_eq!(is_launchable_url("https://"), Err(LaunchDenied::NoHost));
    }

    #[test]
    fn browser_key_slugifies_and_collapses() {
        assert_eq!(browser_key("Google Chrome"), "google-chrome");
        assert_eq!(browser_key("Яндекс Браузер"), "яндекс-браузер");
        assert_eq!(browser_key("Google  Chrome "), browser_key("Google Chrome"));
    }

    #[test]
    fn family_of_classifies_known_exes() {
        for exe in ["chrome.exe", "msedge.exe", "brave.exe", "vivaldi.exe", "opera.exe"] {
            assert_eq!(family_of("", Path::new(exe)), Family::Chromium, "exe: {exe}");
        }
        assert_eq!(
            family_of("", Path::new(r"C:\Users\me\AppData\Local\Yandex\YandexBrowser\Application\browser.exe")),
            Family::Chromium
        );
        assert_eq!(family_of("", Path::new("firefox.exe")), Family::Firefox);
        assert_eq!(family_of("", Path::new("librewolf.exe")), Family::Other);
    }

    #[test]
    fn icon_key_covers_special_cases() {
        assert_eq!(
            icon_key("Yandex Browser", Path::new(r"C:\Users\me\AppData\Local\Yandex\YandexBrowser\Application\browser.exe")),
            Some("yandex")
        );
        assert_eq!(
            icon_key("Tor Browser", Path::new(r"C:\Tor Browser\Browser\firefox.exe")),
            Some("tor")
        );
        assert_eq!(icon_key("LibreWolf", Path::new("librewolf.exe")), None);
    }

    fn local_state_sample() -> String {
        r#"{
            "profile": {
                "profiles_order": ["Default", "Profile 1", "Profile 3"],
                "info_cache": {
                    "Default": { "name": "stillmvd", "gaia_picture_file_name": "Google Profile Picture.png" },
                    "Profile 1": { "name": "Работа" },
                    "Profile 3": { "name": "Kimi", "gaia_picture_file_name": "Google Profile Picture.png" }
                }
            }
        }"#
        .to_string()
    }

    #[test]
    fn parse_local_state_respects_profiles_order() {
        let profiles = parse_local_state(&local_state_sample());
        let names: Vec<&str> = profiles.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["stillmvd", "Работа", "Kimi"]);
        assert_eq!(profiles[0].gaia_picture.as_deref(), Some("Google Profile Picture.png"));
        assert_eq!(profiles[1].gaia_picture, None);
    }

    #[test]
    fn parse_local_state_without_order_sorts_by_dir_name() {
        let json = r#"{
            "profile": {
                "info_cache": {
                    "Profile 3": { "name": "Kimi" },
                    "Default": { "name": "stillmvd" },
                    "Profile 1": { "name": "Работа" }
                }
            }
        }"#;
        let profiles = parse_local_state(json);
        let dirs: Vec<&str> = profiles.iter().map(|p| p.dir.as_str()).collect();
        assert_eq!(dirs, ["Default", "Profile 1", "Profile 3"]);
    }

    #[test]
    fn parse_local_state_recovers_from_garbage() {
        assert_eq!(parse_local_state("not json at all"), Vec::new());
        assert_eq!(parse_local_state(r#"{"other":true}"#), Vec::new());
    }

    fn profiles_ini_sample() -> &'static str {
        "[General]\n\
         StartWithLastProfile=1\n\
         Version=2\n\
         \n\
         [Profile0]\n\
         Name=default-release\n\
         IsRelative=1\n\
         Path=Profiles/C09sTfVb.Профиль 1\n\
         StoreID=98c5fa9c\n\
         ShowSelector=1\n\
         \n\
         [Profile1]\n\
         Name=default\n\
         IsRelative=1\n\
         Path=Profiles/z9w3iukd.default\n\
         Default=1\n\
         \n\
         [BackgroundTasksProfiles]\n\
         MozillaBackgroundTask-308046B0AF4A39CB-defaultagent=tpn3kbmo\n\
         \n\
         [Install308046B0AF4A39CB]\n\
         Default=Profiles/C09sTfVb.Профиль 1\n\
         Locked=1\n"
    }

    #[test]
    fn parse_profiles_ini_skips_non_profile_sections() {
        let parsed = parse_profiles_ini(profiles_ini_sample());
        assert_eq!(parsed.profiles.len(), 2);
        assert!(parsed.profiles.iter().any(|p| p.path == "Profiles/C09sTfVb.Профиль 1"));
    }

    #[test]
    fn parse_profiles_ini_uses_install_default_not_legacy_flag() {
        let parsed = parse_profiles_ini(profiles_ini_sample());
        assert_eq!(parsed.install_default.as_deref(), Some("default-release"));
    }

    #[test]
    fn set_target_and_target_for_round_trip() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let parsed = url_norm::parse("https://example.test/browsers").unwrap();
        let id = crate::bookmarks::create(&conn, None, "Target", &parsed, None, None).unwrap();

        let target = BrowserTarget {
            browser: Some("Google Chrome".to_string()),
            profile: Some("Profile 1".to_string()),
            profile_name: Some("Работа".to_string()),
        };
        set_target(&conn, id, &target).unwrap();
        assert_eq!(target_for(&conn, id).unwrap(), target);

        set_target(&conn, id, &BrowserTarget::default()).unwrap();
        let cleared = target_for(&conn, id).unwrap();
        assert_eq!(cleared, BrowserTarget::default());
    }
}
