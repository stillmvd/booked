use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

pub fn theme_str(t: Theme) -> &'static str {
    match t {
        Theme::System => "system",
        Theme::Light => "light",
        Theme::Dark => "dark",
    }
}

pub fn theme_from_str(s: &str) -> Theme {
    match s {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => Theme::System,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseAction {
    Ask,
    Tray,
    Quit,
}

pub fn close_action_str(a: CloseAction) -> &'static str {
    match a {
        CloseAction::Ask => "ask",
        CloseAction::Tray => "tray",
        CloseAction::Quit => "quit",
    }
}

pub fn close_action_from_str(s: &str) -> CloseAction {
    match s {
        "tray" => CloseAction::Tray,
        "quit" => CloseAction::Quit,
        _ => CloseAction::Ask,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LivenessPeriod {
    Day,
    Week,
    Month,
    Never,
}

pub fn liveness_period_str(p: LivenessPeriod) -> &'static str {
    match p {
        LivenessPeriod::Day => "day",
        LivenessPeriod::Week => "week",
        LivenessPeriod::Month => "month",
        LivenessPeriod::Never => "never",
    }
}

pub fn liveness_period_from_str(s: &str) -> LivenessPeriod {
    match s {
        "day" => LivenessPeriod::Day,
        "month" => LivenessPeriod::Month,
        "never" => LivenessPeriod::Never,
        _ => LivenessPeriod::Week,
    }
}

pub fn stale_secs(period: LivenessPeriod) -> Option<i64> {
    match period {
        LivenessPeriod::Day => Some(86400),
        LivenessPeriod::Week => Some(7 * 86400),
        LivenessPeriod::Month => Some(30 * 86400),
        LivenessPeriod::Never => None,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub close_action: CloseAction,
    pub tray_notice_shown: bool,
    pub quick_add_hotkey: String,
    pub liveness_period: LivenessPeriod,
}

fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
}

pub fn read(conn: &Connection) -> rusqlite::Result<Settings> {
    let theme = get(conn, "theme")?.as_deref().map(theme_from_str).unwrap_or(Theme::System);
    let close_action = get(conn, "close_action")?
        .as_deref()
        .map(close_action_from_str)
        .unwrap_or(CloseAction::Ask);
    let tray_notice_shown = get(conn, "tray_notice_shown")?.as_deref() == Some("1");
    let quick_add_hotkey = get(conn, "quick_add_hotkey")?.unwrap_or_else(|| "Ctrl+Alt+B".to_string());
    let liveness_period = get(conn, "liveness_period")?
        .as_deref()
        .map(liveness_period_from_str)
        .unwrap_or(LivenessPeriod::Week);

    Ok(Settings {
        theme,
        close_action,
        tray_notice_shown,
        quick_add_hotkey,
        liveness_period,
    })
}

pub fn write(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;

    if key == "liveness_period" {
        let enabled = if liveness_period_from_str(value) == LivenessPeriod::Never { "0" } else { "1" };
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('liveness_enabled', ?1) \
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            params![enabled],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn read_defaults_on_empty_db() {
        let conn = setup();
        let settings = read(&conn).unwrap();
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.close_action, CloseAction::Ask);
        assert!(!settings.tray_notice_shown);
        assert_eq!(settings.quick_add_hotkey, "Ctrl+Alt+B");
        assert_eq!(settings.liveness_period, LivenessPeriod::Week);
    }

    #[test]
    fn read_unknown_value_falls_back_to_default() {
        let conn = setup();
        write(&conn, "theme", "neon").unwrap();
        let settings = read(&conn).unwrap();
        assert_eq!(settings.theme, Theme::System);
    }

    #[test]
    fn write_then_read_roundtrips() {
        let conn = setup();
        write(&conn, "theme", "light").unwrap();
        let settings = read(&conn).unwrap();
        assert_eq!(settings.theme, Theme::Light);
    }

    #[test]
    fn write_liveness_period_never_disables_liveness_enabled() {
        let conn = setup();
        write(&conn, "liveness_period", "never").unwrap();
        assert!(!crate::liveness::is_enabled(&conn));
    }

    #[test]
    fn write_liveness_period_other_enables_liveness_enabled() {
        let conn = setup();
        write(&conn, "liveness_period", "never").unwrap();
        write(&conn, "liveness_period", "day").unwrap();
        assert!(crate::liveness::is_enabled(&conn));
    }

    #[test]
    fn stale_secs_matches_periods() {
        assert_eq!(stale_secs(LivenessPeriod::Day), Some(86400));
        assert_eq!(stale_secs(LivenessPeriod::Week), Some(604800));
        assert_eq!(stale_secs(LivenessPeriod::Month), Some(2592000));
        assert_eq!(stale_secs(LivenessPeriod::Never), None);
    }

    #[test]
    fn write_does_not_touch_sibling_keys() {
        let conn = setup();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('view_mode', 'list')",
            [],
        )
        .unwrap();

        write(&conn, "theme", "dark").unwrap();

        let view_mode: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'view_mode'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(view_mode, "list");
    }

    #[test]
    fn read_never_writes_to_settings() {
        let conn = setup();
        for _ in 0..10 {
            read(&conn).unwrap();
        }
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
