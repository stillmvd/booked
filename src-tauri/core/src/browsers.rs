use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

const BUNDLE_ORDER: [&str; 8] = ["chrome", "firefox", "edge", "yandex", "brave", "vivaldi", "opera", "tor"];

pub fn bundle_order(icon_key: Option<&str>) -> usize {
    icon_key
        .and_then(|key| BUNDLE_ORDER.iter().position(|k| *k == key))
        .unwrap_or(BUNDLE_ORDER.len())
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
    pub store_id: Option<String>,
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
            let store_id = map.get("StoreID").cloned();
            Some(FirefoxProfile { name, path, is_relative, store_id })
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

#[derive(Debug, Clone, PartialEq)]
pub enum ProfileSource {
    ChromiumUserData(PathBuf),
    FirefoxIni(PathBuf),
    None,
}

pub fn profile_source(icon_key: Option<&str>, local_app_data: &Path, roaming_app_data: &Path) -> ProfileSource {
    match icon_key {
        Some("chrome") => ProfileSource::ChromiumUserData(local_app_data.join(r"Google\Chrome\User Data")),
        Some("edge") => ProfileSource::ChromiumUserData(local_app_data.join(r"Microsoft\Edge\User Data")),
        Some("brave") => {
            ProfileSource::ChromiumUserData(local_app_data.join(r"BraveSoftware\Brave-Browser\User Data"))
        }
        Some("vivaldi") => ProfileSource::ChromiumUserData(local_app_data.join(r"Vivaldi\User Data")),
        Some("yandex") => ProfileSource::ChromiumUserData(local_app_data.join(r"Yandex\YandexBrowser\User Data")),
        Some("firefox") => ProfileSource::FirefoxIni(roaming_app_data.join(r"Mozilla\Firefox\profiles.ini")),
        _ => ProfileSource::None,
    }
}

pub fn order_firefox(profiles: Vec<FirefoxProfile>, install_default: Option<&str>) -> Vec<FirefoxProfile> {
    let Some(default_name) = install_default else { return profiles };
    let mut first = Vec::new();
    let mut rest = Vec::new();
    for profile in profiles {
        if profile.name == default_name {
            first.push(profile);
        } else {
            rest.push(profile);
        }
    }
    first.extend(rest);
    first
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

fn setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0)).optional()
}

pub fn default_target(conn: &Connection) -> rusqlite::Result<BrowserTarget> {
    Ok(BrowserTarget {
        browser: setting(conn, "default_browser")?,
        profile: setting(conn, "default_profile")?,
        profile_name: setting(conn, "default_profile_name")?,
    })
}

pub fn set_default_target(conn: &Connection, target: &BrowserTarget) -> rusqlite::Result<()> {
    let browser = target.browser.as_deref().filter(|s| !s.is_empty());
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM settings WHERE key IN ('default_browser', 'default_profile', 'default_profile_name')",
        [],
    )?;
    if let Some(browser) = browser {
        tx.execute("INSERT INTO settings (key, value) VALUES ('default_browser', ?1)", params![browser])?;
        if let Some(profile) = target.profile.as_deref() {
            tx.execute("INSERT INTO settings (key, value) VALUES ('default_profile', ?1)", params![profile])?;
        }
        if let Some(profile_name) = target.profile_name.as_deref() {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES ('default_profile_name', ?1)",
                params![profile_name],
            )?;
        }
    }
    tx.commit()
}

#[derive(Debug, Clone, PartialEq)]
pub struct FirefoxGroupProfile {
    pub path: String,
    pub name: String,
}

pub fn read_firefox_group(conn: &Connection) -> rusqlite::Result<Vec<FirefoxGroupProfile>> {
    let mut stmt = conn.prepare("SELECT path, name FROM Profiles ORDER BY id")?;
    let rows = stmt.query_map([], |row| Ok(FirefoxGroupProfile { path: row.get(0)?, name: row.get(1)? }))?;
    rows.collect()
}

pub fn firefox_group_db(firefox_root: &Path, profiles: &[FirefoxProfile]) -> Option<PathBuf> {
    let store_id = profiles.iter().find_map(|p| p.store_id.as_deref().filter(|id| !id.is_empty()))?;
    Some(firefox_root.join("Profile Groups").join(format!("{store_id}.sqlite")))
}

pub fn firefox_profile_dir(firefox_root: &Path, path: &str) -> PathBuf {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        firefox_root.join(candidate)
    }
}

pub fn firefox_launch_args(profile: &str) -> [String; 2] {
    if Path::new(profile).is_absolute() {
        ["--profile".to_string(), profile.to_string()]
    } else {
        ["-P".to_string(), profile.to_string()]
    }
}

pub fn is_excluded_browser(exe: &Path) -> bool {
    exe_file_name_lower(exe) == "iexplore.exe"
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
    fn bundle_order_ranks_known_before_unknown() {
        assert!(bundle_order(Some("chrome")) < bundle_order(Some("firefox")));
        assert!(bundle_order(Some("tor")) < bundle_order(None));
        assert!(bundle_order(Some("tor")) < bundle_order(Some("librewolf")));
        assert_eq!(bundle_order(Some("librewolf")), bundle_order(None));
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
    fn profile_source_maps_all_known_icon_keys_and_absent_key() {
        let local = Path::new(r"C:\Users\me\AppData\Local");
        let roaming = Path::new(r"C:\Users\me\AppData\Roaming");
        assert_eq!(
            profile_source(Some("chrome"), local, roaming),
            ProfileSource::ChromiumUserData(local.join(r"Google\Chrome\User Data"))
        );
        assert_eq!(
            profile_source(Some("edge"), local, roaming),
            ProfileSource::ChromiumUserData(local.join(r"Microsoft\Edge\User Data"))
        );
        assert_eq!(
            profile_source(Some("brave"), local, roaming),
            ProfileSource::ChromiumUserData(local.join(r"BraveSoftware\Brave-Browser\User Data"))
        );
        assert_eq!(
            profile_source(Some("vivaldi"), local, roaming),
            ProfileSource::ChromiumUserData(local.join(r"Vivaldi\User Data"))
        );
        assert_eq!(
            profile_source(Some("yandex"), local, roaming),
            ProfileSource::ChromiumUserData(local.join(r"Yandex\YandexBrowser\User Data"))
        );
        assert_eq!(
            profile_source(Some("firefox"), local, roaming),
            ProfileSource::FirefoxIni(roaming.join(r"Mozilla\Firefox\profiles.ini"))
        );
        assert_eq!(profile_source(Some("opera"), local, roaming), ProfileSource::None);
        assert_eq!(profile_source(Some("tor"), local, roaming), ProfileSource::None);
        assert_eq!(profile_source(None, local, roaming), ProfileSource::None);
    }

    #[test]
    fn order_firefox_puts_install_default_first_not_legacy_flag() {
        let parsed = parse_profiles_ini(profiles_ini_sample());
        let ordered = order_firefox(parsed.profiles.clone(), parsed.install_default.as_deref());
        assert_eq!(ordered[0].name, "default-release");
        assert_eq!(ordered[1].name, "default");
    }

    #[test]
    fn order_firefox_without_install_default_keeps_file_order() {
        let parsed = parse_profiles_ini(profiles_ini_sample());
        let ordered = order_firefox(parsed.profiles.clone(), None);
        assert_eq!(ordered, parsed.profiles);
    }

    #[test]
    fn parse_profiles_ini_parses_store_id() {
        let parsed = parse_profiles_ini(profiles_ini_sample());
        let default_release = parsed.profiles.iter().find(|p| p.name == "default-release").unwrap();
        assert_eq!(default_release.store_id.as_deref(), Some("98c5fa9c"));
        let default = parsed.profiles.iter().find(|p| p.name == "default").unwrap();
        assert_eq!(default.store_id, None);
    }

    #[test]
    fn firefox_group_db_takes_first_store_id() {
        let root = Path::new(r"C:\Users\me\AppData\Roaming\Mozilla\Firefox");
        let parsed = parse_profiles_ini(profiles_ini_sample());
        assert_eq!(
            firefox_group_db(root, &parsed.profiles),
            Some(root.join("Profile Groups").join("98c5fa9c.sqlite"))
        );
    }

    #[test]
    fn firefox_group_db_none_without_store_id() {
        let profiles = vec![FirefoxProfile {
            name: "default".to_string(),
            path: "Profiles/z9w3iukd.default".to_string(),
            is_relative: true,
            store_id: None,
        }];
        assert_eq!(firefox_group_db(Path::new(r"C:\Users\me\AppData\Roaming\Mozilla\Firefox"), &profiles), None);
    }

    #[test]
    fn read_firefox_group_returns_names_in_id_order() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Profiles (id INTEGER PRIMARY KEY, path TEXT UNIQUE, name TEXT, avatar TEXT, \
             themeId TEXT, themeFg TEXT, themeBg TEXT);
             INSERT INTO Profiles (id, path, name) VALUES (1, 'Profiles\\xani2d3d.default-release', 'Dark');
             INSERT INTO Profiles (id, path, name) VALUES (2, 'Profiles\\C09sTfVb.Профиль 1', 'Claude');",
        )
        .unwrap();
        let profiles = read_firefox_group(&conn).unwrap();
        let names: Vec<&str> = profiles.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Dark", "Claude"]);
    }

    #[test]
    fn firefox_profile_dir_joins_relative_and_keeps_absolute() {
        let root = Path::new(r"C:\Users\me\AppData\Roaming\Mozilla\Firefox");
        assert_eq!(
            firefox_profile_dir(root, "Profiles/C09sTfVb.Профиль 1"),
            root.join("Profiles/C09sTfVb.Профиль 1")
        );
        let absolute = r"D:\OtherFirefox\Profiles\abc.default";
        assert_eq!(firefox_profile_dir(root, absolute), PathBuf::from(absolute));
    }

    #[test]
    fn firefox_launch_args_uses_dash_p_for_name_and_profile_flag_for_path() {
        assert_eq!(firefox_launch_args("default-release"), ["-P".to_string(), "default-release".to_string()]);
        let absolute = r"C:\Users\me\AppData\Roaming\Mozilla\Firefox\Profiles\C09sTfVb.Профиль 1";
        assert_eq!(firefox_launch_args(absolute), ["--profile".to_string(), absolute.to_string()]);
    }

    #[test]
    fn is_excluded_browser_flags_internet_explorer_case_insensitive() {
        assert!(is_excluded_browser(Path::new(r"C:\Program Files\Internet Explorer\IEXPLORE.EXE")));
        assert!(!is_excluded_browser(Path::new(r"C:\Program Files\Mozilla Firefox\firefox.exe")));
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

    #[test]
    fn default_target_round_trip_and_clear() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(default_target(&conn).unwrap(), BrowserTarget::default());

        let target = BrowserTarget {
            browser: Some("Google Chrome".to_string()),
            profile: Some("Profile 1".to_string()),
            profile_name: Some("Работа".to_string()),
        };
        set_default_target(&conn, &target).unwrap();
        assert_eq!(default_target(&conn).unwrap(), target);

        set_default_target(&conn, &BrowserTarget::default()).unwrap();
        assert_eq!(default_target(&conn).unwrap(), BrowserTarget::default());
    }

    #[test]
    fn default_target_and_bookmark_assignment_do_not_intersect() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let parsed = url_norm::parse("https://example.test/default-vs-bookmark").unwrap();
        let id = crate::bookmarks::create(&conn, None, "T", &parsed, None, None).unwrap();

        let bookmark_target = BrowserTarget { browser: Some("Firefox".to_string()), profile: None, profile_name: None };
        set_target(&conn, id, &bookmark_target).unwrap();

        let default = BrowserTarget { browser: Some("Google Chrome".to_string()), profile: None, profile_name: None };
        set_default_target(&conn, &default).unwrap();

        assert_eq!(target_for(&conn, id).unwrap(), bookmark_target);
        assert_eq!(default_target(&conn).unwrap(), default);
    }
}
