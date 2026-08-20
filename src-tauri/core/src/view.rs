use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewMode {
    Tiles,
    List,
    Compact,
}

pub fn mode_str(m: ViewMode) -> &'static str {
    match m {
        ViewMode::Tiles => "tiles",
        ViewMode::List => "list",
        ViewMode::Compact => "compact",
    }
}

pub fn mode_from_str(s: &str) -> ViewMode {
    match s {
        "list" => ViewMode::List,
        "compact" => ViewMode::Compact,
        _ => ViewMode::Tiles,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    pub mode: ViewMode,
    pub source: &'static str,
    pub band_collapsed: bool,
    pub overrides_exist: bool,
}

fn global_mode(conn: &Connection) -> rusqlite::Result<ViewMode> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'view_mode'", [], |row| row.get(0))
        .optional()?;
    Ok(value.as_deref().map(mode_from_str).unwrap_or(ViewMode::Tiles))
}

fn overrides_exist(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM folders WHERE view_mode IS NOT NULL)",
        [],
        |row| row.get(0),
    )
}

pub fn state(conn: &Connection, folder_id: Option<i64>) -> rusqlite::Result<ViewState> {
    let global = global_mode(conn)?;
    let overrides_exist = overrides_exist(conn)?;

    match folder_id {
        Some(id) => {
            let row: Option<(Option<String>, i64)> = conn
                .query_row(
                    "SELECT view_mode, band_collapsed FROM folders WHERE id = ?1",
                    params![id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let (folder_mode, band_collapsed) = row.unwrap_or((None, 0));
            Ok(match folder_mode {
                Some(m) => ViewState {
                    mode: mode_from_str(&m),
                    source: "folder",
                    band_collapsed: band_collapsed != 0,
                    overrides_exist,
                },
                None => ViewState {
                    mode: global,
                    source: "global",
                    band_collapsed: band_collapsed != 0,
                    overrides_exist,
                },
            })
        }
        None => {
            let root_collapsed: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'band_collapsed_root'",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(ViewState {
                mode: global,
                source: "global",
                band_collapsed: root_collapsed.as_deref() == Some("1"),
                overrides_exist,
            })
        }
    }
}

pub fn set_mode(conn: &Connection, folder_id: Option<i64>, mode: ViewMode) -> rusqlite::Result<()> {
    match folder_id {
        Some(id) => {
            conn.execute(
                "UPDATE folders SET view_mode = ?1, updated_at = unixepoch() WHERE id = ?2",
                params![mode_str(mode), id],
            )?;
        }
        None => {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('view_mode', ?1) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![mode_str(mode)],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::folders;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn state_defaults_to_tiles_on_empty_db() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();

        let root = state(&conn, None).unwrap();
        assert_eq!(root.mode, ViewMode::Tiles);
        assert_eq!(root.source, "global");
        assert!(!root.overrides_exist);

        let folder = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(folder.mode, ViewMode::Tiles);
        assert_eq!(folder.source, "global");
    }

    #[test]
    fn state_inherits_global_when_folder_override_is_null() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        set_mode(&conn, None, ViewMode::Compact).unwrap();

        let result = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(result.mode, ViewMode::Compact);
        assert_eq!(result.source, "global");
    }

    #[test]
    fn state_prefers_folder_override() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        set_mode(&conn, None, ViewMode::Compact).unwrap();
        set_mode(&conn, Some(folder_id), ViewMode::List).unwrap();

        let result = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(result.mode, ViewMode::List);
        assert_eq!(result.source, "folder");
    }

    #[test]
    fn reading_state_never_writes() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();

        for _ in 0..50 {
            state(&conn, Some(folder_id)).unwrap();
            state(&conn, None).unwrap();
        }

        let view_mode: Option<String> = conn
            .query_row("SELECT view_mode FROM folders WHERE id = ?1", params![folder_id], |row| row.get(0))
            .unwrap();
        assert_eq!(view_mode, None);

        let settings_count: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0)).unwrap();
        assert_eq!(settings_count, 0);
    }

    #[test]
    fn set_mode_in_root_writes_global_not_folder() {
        let conn = setup();
        folders::create(&conn, "A", None).unwrap();
        folders::create(&conn, "B", None).unwrap();

        set_mode(&conn, None, ViewMode::List).unwrap();

        let mut stmt = conn.prepare("SELECT view_mode FROM folders").unwrap();
        let modes: Vec<Option<String>> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(modes.iter().all(|m| m.is_none()));

        let global: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'view_mode'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(global, "list");
    }
}
