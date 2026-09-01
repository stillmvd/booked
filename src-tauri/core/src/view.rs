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
    pub sort_key: Option<String>,
    pub sort_dir: Option<String>,
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
            let row: Option<(Option<String>, i64, Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT view_mode, band_collapsed, sort_key, sort_dir FROM folders WHERE id = ?1",
                    params![id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            let (folder_mode, band_collapsed, sort_key, sort_dir) = row.unwrap_or((None, 0, None, None));
            Ok(match folder_mode {
                Some(m) => ViewState {
                    mode: mode_from_str(&m),
                    source: "folder",
                    band_collapsed: band_collapsed != 0,
                    overrides_exist,
                    sort_key,
                    sort_dir,
                },
                None => ViewState {
                    mode: global,
                    source: "global",
                    band_collapsed: band_collapsed != 0,
                    overrides_exist,
                    sort_key,
                    sort_dir,
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
            let sort_key: Option<String> = conn
                .query_row("SELECT value FROM settings WHERE key = 'sort_key'", [], |row| row.get(0))
                .optional()?;
            let sort_dir: Option<String> = conn
                .query_row("SELECT value FROM settings WHERE key = 'sort_dir'", [], |row| row.get(0))
                .optional()?;
            Ok(ViewState {
                mode: global,
                source: "global",
                band_collapsed: root_collapsed.as_deref() == Some("1"),
                overrides_exist,
                sort_key,
                sort_dir,
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

pub fn set_sort(
    conn: &Connection,
    folder_id: Option<i64>,
    key: Option<&str>,
    dir: Option<&str>,
) -> rusqlite::Result<()> {
    match folder_id {
        Some(id) => {
            conn.execute(
                "UPDATE folders SET sort_key = ?1, sort_dir = ?2 WHERE id = ?3",
                params![key, dir, id],
            )?;
        }
        None => {
            match key {
                Some(k) => {
                    conn.execute(
                        "INSERT INTO settings (key, value) VALUES ('sort_key', ?1) \
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![k],
                    )?;
                }
                None => {
                    conn.execute("DELETE FROM settings WHERE key = 'sort_key'", [])?;
                }
            }
            match dir {
                Some(d) => {
                    conn.execute(
                        "INSERT INTO settings (key, value) VALUES ('sort_dir', ?1) \
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![d],
                    )?;
                }
                None => {
                    conn.execute("DELETE FROM settings WHERE key = 'sort_dir'", [])?;
                }
            }
        }
    }
    Ok(())
}

pub fn reset_overrides(conn: &Connection, mode: ViewMode) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE folders SET view_mode = NULL", [])?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('view_mode', ?1) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![mode_str(mode)],
    )?;
    tx.commit()
}

pub fn set_band_collapsed(conn: &Connection, folder_id: Option<i64>, collapsed: bool) -> rusqlite::Result<()> {
    match folder_id {
        Some(id) => {
            conn.execute(
                "UPDATE folders SET band_collapsed = ?1 WHERE id = ?2",
                params![collapsed as i64, id],
            )?;
        }
        None => {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('band_collapsed_root', ?1) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![if collapsed { "1" } else { "0" }],
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

    #[test]
    fn set_band_collapsed_persists_per_folder() {
        let conn = setup();
        let a = folders::create(&conn, "A", None).unwrap();
        let b = folders::create(&conn, "B", None).unwrap();

        set_band_collapsed(&conn, Some(a), true).unwrap();

        let state_a = state(&conn, Some(a)).unwrap();
        let state_b = state(&conn, Some(b)).unwrap();
        assert!(state_a.band_collapsed);
        assert!(!state_b.band_collapsed);
    }

    #[test]
    fn set_mode_in_folder_writes_only_that_folder() {
        let conn = setup();
        let a = folders::create(&conn, "A", None).unwrap();
        let b = folders::create(&conn, "B", None).unwrap();

        set_mode(&conn, Some(a), ViewMode::List).unwrap();

        let mode_b: Option<String> = conn
            .query_row("SELECT view_mode FROM folders WHERE id = ?1", params![b], |row| row.get(0))
            .unwrap();
        assert_eq!(mode_b, None);

        let global: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = 'view_mode'", [], |row| row.get(0))
            .optional()
            .unwrap();
        assert_eq!(global, None);
    }

    #[test]
    fn reset_overrides_clears_every_folder() {
        let conn = setup();
        let a = folders::create(&conn, "A", None).unwrap();
        let b = folders::create(&conn, "B", None).unwrap();
        set_mode(&conn, Some(a), ViewMode::List).unwrap();
        set_mode(&conn, Some(b), ViewMode::Compact).unwrap();

        reset_overrides(&conn, ViewMode::Tiles).unwrap();

        let mut stmt = conn.prepare("SELECT view_mode FROM folders").unwrap();
        let modes: Vec<Option<String>> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(modes.iter().all(|m| m.is_none()));

        let global = global_mode(&conn).unwrap();
        assert_eq!(global, ViewMode::Tiles);
    }

    #[test]
    fn overrides_exist_reflects_reality() {
        let conn = setup();
        let a = folders::create(&conn, "A", None).unwrap();
        assert!(!overrides_exist(&conn).unwrap());

        set_mode(&conn, Some(a), ViewMode::List).unwrap();
        assert!(overrides_exist(&conn).unwrap());

        reset_overrides(&conn, ViewMode::Tiles).unwrap();
        assert!(!overrides_exist(&conn).unwrap());
    }

    #[test]
    fn state_defaults_sort_to_manual_on_folder_without_record() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();

        let result = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(result.sort_key, None);
        assert_eq!(result.sort_dir, None);
    }

    #[test]
    fn set_sort_persists_on_folder() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();

        set_sort(&conn, Some(folder_id), Some("name"), Some("desc")).unwrap();

        let result = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(result.sort_key.as_deref(), Some("name"));
        assert_eq!(result.sort_dir.as_deref(), Some("desc"));
    }

    #[test]
    fn set_sort_empty_key_returns_folder_to_manual_order() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        set_sort(&conn, Some(folder_id), Some("name"), Some("asc")).unwrap();

        set_sort(&conn, Some(folder_id), None, None).unwrap();

        let result = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(result.sort_key, None);
        assert_eq!(result.sort_dir, None);
    }

    #[test]
    fn set_sort_in_root_writes_settings_not_folders() {
        let conn = setup();
        folders::create(&conn, "A", None).unwrap();

        set_sort(&conn, None, Some("host"), Some("asc")).unwrap();

        let result = state(&conn, None).unwrap();
        assert_eq!(result.sort_key.as_deref(), Some("host"));
        assert_eq!(result.sort_dir.as_deref(), Some("asc"));

        let touched: i64 = conn
            .query_row("SELECT COUNT(*) FROM folders WHERE sort_key IS NOT NULL", [], |row| row.get(0))
            .unwrap();
        assert_eq!(touched, 0);
    }

    #[test]
    fn folder_and_root_sort_are_independent() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        set_sort(&conn, None, Some("added"), Some("desc")).unwrap();
        set_sort(&conn, Some(folder_id), Some("name"), Some("asc")).unwrap();

        let root = state(&conn, None).unwrap();
        let folder = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(root.sort_key.as_deref(), Some("added"));
        assert_eq!(folder.sort_key.as_deref(), Some("name"));
    }

    #[test]
    fn root_sort_does_not_inherit_into_folder_without_own_sort() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        set_sort(&conn, None, Some("tags"), Some("desc")).unwrap();

        let folder = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(folder.sort_key, None);
        assert_eq!(folder.sort_dir, None);
    }

    #[test]
    fn set_sort_does_not_touch_view_mode_or_band_collapsed() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        set_mode(&conn, Some(folder_id), ViewMode::List).unwrap();
        set_band_collapsed(&conn, Some(folder_id), true).unwrap();

        set_sort(&conn, Some(folder_id), Some("name"), Some("asc")).unwrap();

        let result = state(&conn, Some(folder_id)).unwrap();
        assert_eq!(result.mode, ViewMode::List);
        assert!(result.band_collapsed);
    }

    #[test]
    fn set_sort_does_not_reindex_folders_fts_or_change_path() {
        let conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();

        let count_before: i64 = conn.query_row("SELECT COUNT(*) FROM folders_fts", [], |row| row.get(0)).unwrap();
        let matched_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM folders_fts WHERE folders_fts MATCH '\"design\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let path_before: String = conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![folder_id], |row| row.get(0))
            .unwrap();

        set_sort(&conn, Some(folder_id), Some("name"), Some("desc")).unwrap();

        let count_after: i64 = conn.query_row("SELECT COUNT(*) FROM folders_fts", [], |row| row.get(0)).unwrap();
        let matched_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM folders_fts WHERE folders_fts MATCH '\"design\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let path_after: String = conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![folder_id], |row| row.get(0))
            .unwrap();

        assert_eq!(count_before, count_after);
        assert_eq!(matched_before, matched_after);
        assert_eq!(path_before, path_after);
    }
}
