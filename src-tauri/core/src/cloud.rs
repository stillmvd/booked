use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::games;

pub const DEFAULT_URL: &str = "https://booked-cloud.mozhno-sync.workers.dev";
pub const URL_KEY: &str = "cloud.url";
pub const CURSOR_KEY: &str = "cloud.cursor";

pub const MAX_BATCH: usize = 200;
pub const MAX_BATCH_BYTES: usize = 60 * 1024;

const FULL_FIELDS: &[&str] = &[
    "status",
    "rating",
    "installedVersion",
    "siteVersion",
    "title",
    "engine",
    "inLibrary",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WireChange {
    pub id: i64,
    pub field: String,
    pub v: Value,
    pub at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pending {
    pub thread_id: i64,
    pub field: String,
    pub last_id: i64,
    pub wire: Option<WireChange>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteField {
    pub v: Value,
    pub at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteGame {
    pub id: i64,
    pub seq: i64,
    pub deleted_at: Option<i64>,
    pub doc: HashMap<String, RemoteField>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GamesPage {
    #[serde(default)]
    pub reset: bool,
    #[serde(default)]
    pub games: Vec<RemoteGame>,
    #[serde(default)]
    pub next: i64,
    #[serde(default)]
    pub more: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PushReply {
    #[serde(default)]
    pub applied: i64,
    #[serde(default)]
    pub ignored: i64,
    #[serde(default)]
    pub rejected: Vec<Rejected>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Rejected {
    pub i: usize,
    pub reason: String,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn text_limit(field: &str) -> Option<usize> {
    match field {
        "installedVersion" | "siteVersion" => Some(64),
        "title" => Some(200),
        "engine" => Some(40),
        _ => None,
    }
}

pub fn wire_value(field: &str, raw: &SqlValue) -> Option<Value> {
    if let Some(limit) = text_limit(field) {
        let SqlValue::Text(text) = raw else {
            return None;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        let mut units = 0;
        let fitted: String = trimmed
            .chars()
            .take_while(|c| {
                units += c.len_utf16();
                units <= limit
            })
            .collect();
        return Some(Value::String(fitted));
    }
    match (field, raw) {
        ("status", SqlValue::Text(status)) => match status.as_str() {
            "dropped" | "disliked" => Some(json!("disliked")),
            "new" | "playing" | "finished" | "wish" | "waiting" => Some(json!(status)),
            _ => None,
        },
        ("rating", SqlValue::Integer(rating)) => Some(json!((*rating).clamp(0, 5))),
        ("inLibrary" | "deleted", SqlValue::Integer(flag)) => Some(json!(*flag != 0)),
        _ => None,
    }
}

fn thread_from_url(url: Option<&str>) -> Option<i64> {
    url.and_then(games::f95_thread_id).and_then(|id| id.parse().ok())
}

pub fn relink_thread(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let Some((page, current)): Option<(Option<String>, Option<i64>)> = conn
        .query_row(
            "SELECT page_url, f95_thread_id FROM games WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
    else {
        return Ok(());
    };
    let wanted = thread_from_url(page.as_deref());
    let free = match wanted {
        Some(thread) => conn
            .query_row(
                "SELECT NOT EXISTS(SELECT 1 FROM games WHERE f95_thread_id = ?1 AND id != ?2)",
                params![thread, id],
                |row| row.get::<_, bool>(0),
            )?
            .then_some(thread),
        None => None,
    };
    if free == current {
        return Ok(());
    }
    conn.execute("UPDATE games SET f95_thread_id = ?1 WHERE id = ?2", params![free, id])?;
    if free.is_some() {
        enqueue_full(conn, id)?;
    }
    Ok(())
}

pub fn fill_thread_ids(conn: &Connection) -> rusqlite::Result<()> {
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM games WHERE f95_thread_id IS NULL AND page_url IS NOT NULL ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?;
        rows
    };
    for id in ids {
        relink_thread(conn, id)?;
    }
    Ok(())
}

fn field_times(raw: Option<&str>) -> Map<String, Value> {
    raw.and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

pub fn enqueue_full(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn
        .query_row(
            "SELECT f95_thread_id, field_at, status, rating, version_installed, site_version, \
             title, title_source, engine, folder_path IS NOT NULL FROM games WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    [
                        row.get::<_, SqlValue>(2)?,
                        row.get::<_, SqlValue>(3)?,
                        row.get::<_, SqlValue>(4)?,
                        row.get::<_, SqlValue>(5)?,
                        row.get::<_, SqlValue>(6)?,
                        row.get::<_, SqlValue>(8)?,
                        row.get::<_, SqlValue>(9)?,
                    ],
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((Some(thread), times, values, title_source)) = row else {
        return Ok(());
    };
    let times = field_times(times.as_deref());
    for (field, value) in FULL_FIELDS.iter().zip(values) {
        if *field == "title" && title_source == "folder" {
            continue;
        }
        if *field == "engine" && matches!(&value, SqlValue::Text(e) if e == games::ENGINE_UNKNOWN) {
            continue;
        }
        if wire_value(field, &value).is_none() {
            continue;
        }
        let at = times.get(*field).and_then(Value::as_i64).unwrap_or(0);
        conn.execute(
            "INSERT INTO sync_outbox (thread_id, field, value, at) VALUES (?1, ?2, ?3, ?4)",
            params![thread, field, value, at],
        )?;
    }
    conn.execute(
        "INSERT INTO sync_outbox (thread_id, field, value, at) VALUES (?1, 'deleted', 0, ?2)",
        params![thread, now_ms()],
    )?;
    Ok(())
}

pub fn outbox_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM (SELECT 1 FROM sync_outbox GROUP BY thread_id, field)",
        [],
        |row| row.get(0),
    )
}

pub fn pending(conn: &Connection) -> rusqlite::Result<Vec<Pending>> {
    let mut stmt = conn.prepare(
        "SELECT o.id, o.thread_id, o.field, o.value, o.at FROM sync_outbox o \
         WHERE o.id = (SELECT MAX(id) FROM sync_outbox l WHERE l.thread_id = o.thread_id AND l.field = o.field) \
         ORDER BY o.id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let thread_id: i64 = row.get(1)?;
            let field: String = row.get(2)?;
            let value: SqlValue = row.get(3)?;
            let at: i64 = row.get(4)?;
            let wire = wire_value(&field, &value).map(|v| WireChange { id: thread_id, field: field.clone(), v, at });
            Ok(Pending { thread_id, field, last_id: id, wire })
        })?
        .collect();
    rows
}

pub fn batches(items: &[Pending]) -> Vec<&[Pending]> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut bytes = 0;
    for (index, item) in items.iter().enumerate() {
        let size = item
            .wire
            .as_ref()
            .and_then(|wire| serde_json::to_vec(wire).ok())
            .map_or(0, |encoded| encoded.len() + 1);
        if index > start && (index - start >= MAX_BATCH || bytes + size > MAX_BATCH_BYTES) {
            out.push(&items[start..index]);
            start = index;
            bytes = 0;
        }
        bytes += size;
    }
    if start < items.len() {
        out.push(&items[start..]);
    }
    out
}

pub fn wire_of(batch: &[Pending]) -> Vec<WireChange> {
    batch.iter().filter_map(|item| item.wire.clone()).collect()
}

pub const BUSY_REASON: &str = "row busy, retry";

pub fn settled<'a>(batch: &'a [Pending], reply: &PushReply) -> Vec<&'a Pending> {
    let wire = wire_of(batch);
    let busy: HashSet<(i64, &str)> = reply
        .rejected
        .iter()
        .filter(|r| r.reason == BUSY_REASON)
        .filter_map(|r| wire.get(r.i))
        .map(|w| (w.id, w.field.as_str()))
        .collect();
    batch
        .iter()
        .filter(|item| !busy.contains(&(item.thread_id, item.field.as_str())))
        .collect()
}

pub fn mark_sent(conn: &mut Connection, batch: &[&Pending]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for item in batch {
        tx.execute(
            "DELETE FROM sync_outbox WHERE thread_id = ?1 AND field = ?2 AND id <= ?3",
            params![item.thread_id, item.field, item.last_id],
        )?;
    }
    tx.commit()
}

fn apply_field(conn: &Connection, id: i64, field: &str, value: &Value) -> rusqlite::Result<bool> {
    match field {
        "siteVersion" => {
            let Some(version) = value.as_str().map(str::trim).filter(|v| !v.is_empty()) else {
                return Ok(false);
            };
            conn.execute(
                "UPDATE games SET site_version = ?1, seen_version = COALESCE(seen_version, ?1), \
                 updated_at = unixepoch() WHERE id = ?2",
                params![version, id],
            )?;
        }
        "title" => {
            let Some(title) = value.as_str() else {
                return Ok(false);
            };
            games::set_site_title(conn, id, title)?;
        }
        "engine" => {
            let Some(label) = value.as_str().and_then(games::engine_label) else {
                return Ok(false);
            };
            games::set_engine(conn, id, label)?;
        }
        "status" => {
            let local = match value.as_str() {
                Some("disliked") => "dropped",
                Some(status @ ("new" | "playing" | "finished")) => status,
                _ => return Ok(false),
            };
            games::set_status(conn, id, local)?;
        }
        "rating" => {
            let Some(rating) = value.as_i64().filter(|r| (0..=5).contains(r)) else {
                return Ok(false);
            };
            games::set_rating(conn, id, rating)?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

pub fn apply_incoming(conn: &mut Connection, remote: &[RemoteGame]) -> rusqlite::Result<bool> {
    let tx = conn.transaction()?;
    let before: i64 = tx.query_row("SELECT COALESCE(MAX(id), 0) FROM sync_outbox", [], |row| row.get(0))?;
    let mut changed = false;
    for game in remote {
        if game.deleted_at.is_some() {
            continue;
        }
        let Some((id, times)): Option<(i64, Option<String>)> = tx
            .query_row(
                "SELECT id, field_at FROM games WHERE f95_thread_id = ?1",
                params![game.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
        else {
            continue;
        };
        let mut times = field_times(times.as_deref());
        let mut fields: Vec<(&String, &RemoteField)> = game.doc.iter().collect();
        fields.sort_by(|a, b| a.0.cmp(b.0));
        let mut touched = false;
        for (field, remote_field) in fields {
            let local_at = times.get(field.as_str()).and_then(Value::as_i64).unwrap_or(0);
            if remote_field.at <= local_at {
                continue;
            }
            if apply_field(&tx, id, field, &remote_field.v)? {
                times.insert(field.clone(), json!(remote_field.at));
                touched = true;
            }
        }
        if touched {
            tx.execute(
                "UPDATE games SET field_at = ?1 WHERE id = ?2",
                params![Value::Object(times).to_string(), id],
            )?;
            changed = true;
        }
    }
    tx.execute("DELETE FROM sync_outbox WHERE id > ?1", params![before])?;
    tx.commit()?;
    Ok(changed)
}

pub fn missing_in_cloud(conn: &Connection, cloud_ids: &HashSet<i64>) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT id, f95_thread_id FROM games WHERE f95_thread_id IS NOT NULL ORDER BY id",
    )?;
    let rows: Vec<(i64, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows
        .into_iter()
        .filter(|(_, thread)| !cloud_ids.contains(thread))
        .map(|(id, _)| id)
        .collect())
}

pub fn requeue_missing(conn: &mut Connection, cloud_ids: &HashSet<i64>) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let ids = missing_in_cloud(&tx, cloud_ids)?;
    for &id in &ids {
        enqueue_full(&tx, id)?;
    }
    tx.commit()?;
    Ok(ids.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn
    }

    fn add_game(conn: &Connection, base: &str, page: Option<&str>) -> i64 {
        conn.execute(
            "INSERT INTO games (base_name, title, title_source, folder_path, folder_name, version_installed, page_url, source) \
             VALUES (?1, ?1, 'site', ?2, ?1, '0.5', ?3, CASE WHEN ?3 IS NULL THEN NULL ELSE 'f95' END)",
            params![base, format!("E:\\Games\\{base}"), page],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        relink_thread(conn, id).unwrap();
        id
    }

    fn outbox(conn: &Connection) -> Vec<(i64, String, SqlValue)> {
        let mut stmt = conn.prepare("SELECT thread_id, field, value FROM sync_outbox ORDER BY id").unwrap();
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        rows
    }

    fn clear(conn: &Connection) {
        conn.execute("DELETE FROM sync_outbox", []).unwrap();
    }

    fn thread_of(conn: &Connection, id: i64) -> Option<i64> {
        conn.query_row("SELECT f95_thread_id FROM games WHERE id = ?1", params![id], |row| row.get(0))
            .unwrap()
    }

    fn field_at(conn: &Connection, id: i64) -> Map<String, Value> {
        let raw: Option<String> =
            conn.query_row("SELECT field_at FROM games WHERE id = ?1", params![id], |row| row.get(0)).unwrap();
        field_times(raw.as_deref())
    }

    const PAGE: &str = "https://f95zone.to/threads/path-of-desire.318470/";

    #[test]
    fn thread_id_follows_the_page_link() {
        let conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        assert_eq!(thread_of(&conn, id), Some(318470));

        games::set_page(&conn, id, Some("https://author.itch.io/pod")).unwrap();
        relink_thread(&conn, id).unwrap();
        assert_eq!(thread_of(&conn, id), None);

        games::set_page(&conn, id, Some("https://f95zone.to/threads/other.5/")).unwrap();
        relink_thread(&conn, id).unwrap();
        assert_eq!(thread_of(&conn, id), Some(5));

        games::set_page(&conn, id, None).unwrap();
        relink_thread(&conn, id).unwrap();
        assert_eq!(thread_of(&conn, id), None);
    }

    #[test]
    fn second_card_on_the_same_thread_stays_local() {
        let conn = db();
        let first = add_game(&conn, "pod", Some(PAGE));
        let second = add_game(&conn, "pod-copy", Some(PAGE));
        assert_eq!(thread_of(&conn, first), Some(318470));
        assert_eq!(thread_of(&conn, second), None);
    }

    #[test]
    fn fill_links_existing_games_and_queues_them_once() {
        let conn = db();
        conn.execute(
            "INSERT INTO games (base_name, title, page_url, source, status, rating, updated_at) \
             VALUES ('pod', 'Path', ?1, 'f95', 'dropped', 2, 1000)",
            params![PAGE],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (base_name, title, page_url, source) VALUES ('itch', 'Itch', 'https://a.itch.io/b', 'itch')",
            [],
        )
        .unwrap();
        fill_thread_ids(&conn).unwrap();
        fill_thread_ids(&conn).unwrap();

        let items = pending(&conn).unwrap();
        let wire = wire_of(&items);
        assert!(wire.iter().all(|w| w.id == 318470));
        let status = wire.iter().find(|w| w.field == "status").unwrap();
        assert_eq!(status.v, json!("disliked"));
        assert_eq!(status.at, 0, "never edited since tracking: the cloud value wins");
        assert_eq!(wire.iter().find(|w| w.field == "inLibrary").unwrap().v, json!(false));
        assert_eq!(wire.iter().find(|w| w.field == "deleted").unwrap().v, json!(false));
        assert!(wire.iter().all(|w| w.field != "installedVersion"), "empty version is not sent");
        assert_eq!(outbox_count(&conn).unwrap(), 4);
    }

    #[test]
    fn each_tracked_column_queues_exactly_one_change() {
        let conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        clear(&conn);

        games::set_status(&conn, id, "playing").unwrap();
        games::set_rating(&conn, id, 4).unwrap();
        games::set_version(&conn, id, Some("0.6")).unwrap();
        games::record_check(&conn, id, Some("0.7"), false).unwrap();
        games::set_title(&conn, id, "Path of Desire").unwrap();
        games::set_engine(&conn, id, "Ren'Py").unwrap();
        games::detach_folder(&conn, id).unwrap();

        let fields: Vec<String> = outbox(&conn).into_iter().map(|(_, f, _)| f).collect();
        assert_eq!(
            fields,
            ["status", "rating", "installedVersion", "siteVersion", "title", "engine", "inLibrary"]
        );
        let times = field_at(&conn, id);
        for field in &fields {
            assert!(times.get(field).and_then(Value::as_i64).is_some(), "{field} has no edit time");
        }
    }

    #[test]
    fn same_value_and_untracked_cases_queue_nothing() {
        let conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        games::set_status(&conn, id, "playing").unwrap();
        clear(&conn);

        games::set_status(&conn, id, "playing").unwrap();
        games::record_check(&conn, id, None, false).unwrap();
        games::set_engine(&conn, id, games::ENGINE_UNKNOWN).unwrap();
        games::set_cover_pos(&conn, id, 10.0, 10.0, 1.0).unwrap();
        conn.execute("UPDATE games SET title = 'Folder Name', title_source = 'folder' WHERE id = ?1", params![id])
            .unwrap();
        assert!(outbox(&conn).is_empty());

        let itch = add_game(&conn, "itch", Some("https://a.itch.io/b"));
        games::set_status(&conn, itch, "finished").unwrap();
        assert!(outbox(&conn).is_empty());
    }

    #[test]
    fn folder_sync_and_forget_reach_the_queue() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        clear(&conn);

        games::sync(&mut conn, &[]).unwrap();
        assert_eq!(outbox(&conn), vec![(318470, "inLibrary".to_string(), SqlValue::Integer(0))]);
        clear(&conn);

        games::forget(&conn, id).unwrap();
        assert_eq!(outbox(&conn), vec![(318470, "deleted".to_string(), SqlValue::Integer(1))]);
    }

    #[test]
    fn merge_keeps_the_thread_alive() {
        let mut conn = db();
        conn.execute(
            "INSERT INTO games (base_name, title, folder_path, folder_name) VALUES ('pod1', 'Path', 'E:\\Games\\pod1', 'pod1')",
            [],
        )
        .unwrap();
        let old = conn.last_insert_rowid();
        let fresh = add_game(&conn, "pod2", Some(PAGE));
        clear(&conn);

        let cards = crate::game_merge::merge_cards(&conn, &[old, fresh]).unwrap();
        let plan = crate::game_merge::plan_merge(&cards, fresh, false).unwrap();
        assert_eq!((plan.survivor_id, plan.leaving_ids.clone()), (old, vec![fresh]));
        crate::game_merge::apply_merge(&mut conn, &plan).unwrap();

        assert_eq!(thread_of(&conn, old), Some(318470));
        let items = pending(&conn).unwrap();
        let deleted = items.iter().find(|p| p.field == "deleted").unwrap();
        assert_eq!(deleted.wire.as_ref().unwrap().v, json!(false));
    }

    #[test]
    fn queue_collapses_per_field_and_mark_sent_keeps_newer_edits() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        clear(&conn);
        games::set_rating(&conn, id, 1).unwrap();
        games::set_rating(&conn, id, 3).unwrap();
        games::set_status(&conn, id, "finished").unwrap();

        let items = pending(&conn).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].wire.as_ref().unwrap().v, json!(3));
        assert_eq!(outbox_count(&conn).unwrap(), 2);

        games::set_rating(&conn, id, 5).unwrap();
        mark_sent(&mut conn, &items.iter().collect::<Vec<_>>()).unwrap();
        let left = pending(&conn).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].wire.as_ref().unwrap().v, json!(5));
    }

    #[test]
    fn batches_respect_count_and_size() {
        let make = |n: usize, title_len: usize| -> Vec<Pending> {
            (0..n)
                .map(|i| Pending {
                    thread_id: i as i64 + 1,
                    field: "title".into(),
                    last_id: i as i64 + 1,
                    wire: Some(WireChange {
                        id: i as i64 + 1,
                        field: "title".into(),
                        v: json!("я".repeat(title_len)),
                        at: 1,
                    }),
                })
                .collect()
        };
        let small = make(450, 1);
        let sizes: Vec<usize> = batches(&small).iter().map(|b| b.len()).collect();
        assert_eq!(sizes, [200, 200, 50]);

        let big = make(200, 200);
        let parts = batches(&big);
        assert!(parts.len() > 1);
        for part in parts {
            let body = serde_json::to_vec(&json!({ "changes": wire_of(part) })).unwrap();
            assert!(body.len() <= 64 * 1024);
        }
        assert!(batches(&[]).is_empty());
    }

    #[test]
    fn wire_values_follow_the_contract() {
        assert_eq!(wire_value("status", &SqlValue::Text("dropped".into())), Some(json!("disliked")));
        assert_eq!(wire_value("status", &SqlValue::Text("bogus".into())), None);
        assert_eq!(wire_value("inLibrary", &SqlValue::Integer(1)), Some(json!(true)));
        assert_eq!(wire_value("siteVersion", &SqlValue::Text("  ".into())), None);
        assert_eq!(wire_value("siteVersion", &SqlValue::Null), None);
        assert_eq!(
            wire_value("installedVersion", &SqlValue::Text("v".repeat(80))),
            Some(json!("v".repeat(64)))
        );
        assert_eq!(wire_value("engine", &SqlValue::Text("Ren'Py".into())), Some(json!("Ren'Py")));
        let emoji = wire_value("title", &SqlValue::Text("😀".repeat(150))).unwrap();
        assert_eq!(emoji.as_str().unwrap().encode_utf16().count(), 200, "limit counts UTF-16 units like the worker");
    }

    #[test]
    fn linking_a_card_to_a_known_thread_does_not_override_the_cloud() {
        let conn = db();
        conn.execute(
            "INSERT INTO games (base_name, title, folder_path, status, rating) VALUES ('pod', 'Path', 'E:\\Games\\pod', 'new', 0)",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        games::set_page(&conn, id, Some(PAGE)).unwrap();
        let wire = wire_of(&pending(&conn).unwrap());
        let status = wire.iter().find(|w| w.field == "status").unwrap();
        assert_eq!(status.at, 0);

        games::set_rating(&conn, id, 4).unwrap();
        let wire = wire_of(&pending(&conn).unwrap());
        assert!(wire.iter().find(|w| w.field == "rating").unwrap().at > 0, "a real edit carries its time");
    }

    #[test]
    fn busy_rows_stay_in_the_queue() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        clear(&conn);
        games::set_rating(&conn, id, 4).unwrap();
        games::set_status(&conn, id, "playing").unwrap();
        let items = pending(&conn).unwrap();
        let reply = PushReply {
            applied: 1,
            ignored: 0,
            rejected: vec![Rejected { i: 0, reason: BUSY_REASON.into() }],
        };
        let done = settled(&items, &reply);
        assert_eq!(done.iter().map(|p| p.field.as_str()).collect::<Vec<_>>(), ["status"]);
        mark_sent(&mut conn, &done).unwrap();
        let left = pending(&conn).unwrap();
        assert_eq!(left.iter().map(|p| p.field.as_str()).collect::<Vec<_>>(), ["rating"]);

        let refused = PushReply {
            applied: 0,
            ignored: 0,
            rejected: vec![Rejected { i: 0, reason: "rating: integer 0..5 expected".into() }],
        };
        assert_eq!(settled(&left, &refused).len(), 1, "a final refusal leaves the queue");
    }

    fn remote(id: i64, fields: &[(&str, Value, i64)]) -> RemoteGame {
        RemoteGame {
            id,
            seq: 1,
            deleted_at: None,
            doc: fields
                .iter()
                .map(|(f, v, at)| (f.to_string(), RemoteField { v: v.clone(), at: *at }))
                .collect(),
        }
    }

    #[test]
    fn incoming_newer_edit_applies_without_echo() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        clear(&conn);
        let later = now_ms() + 60_000;

        let changed = apply_incoming(
            &mut conn,
            &[remote(318470, &[("rating", json!(4), later), ("status", json!("disliked"), later)])],
        )
        .unwrap();
        assert!(changed);
        let game = games::get(&conn, id).unwrap().unwrap();
        assert_eq!(game.rating, 4);
        assert_eq!(game.status, "dropped");
        assert!(outbox(&conn).is_empty());
        assert_eq!(field_at(&conn, id).get("rating").and_then(Value::as_i64), Some(later));
    }

    #[test]
    fn incoming_older_edit_is_ignored_and_local_queue_survives() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        clear(&conn);
        games::set_rating(&conn, id, 2).unwrap();

        apply_incoming(&mut conn, &[remote(318470, &[("rating", json!(5), 1)])]).unwrap();
        assert_eq!(games::get(&conn, id).unwrap().unwrap().rating, 2);
        assert_eq!(outbox(&conn).len(), 1);
    }

    #[test]
    fn incoming_site_version_raises_the_update_badge() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        apply_incoming(&mut conn, &[remote(318470, &[("siteVersion", json!("0.6"), now_ms())])]).unwrap();
        let game = games::get(&conn, id).unwrap().unwrap();
        assert_eq!(game.site_version.as_deref(), Some("0.6"));
        assert!(game.has_update);
        assert_eq!(game.last_checked_at, None);
    }

    #[test]
    fn incoming_title_keeps_manual_title_and_unknown_things_are_skipped() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        games::set_title(&conn, id, "My Title").unwrap();
        let later = now_ms() + 60_000;
        let changed = apply_incoming(
            &mut conn,
            &[
                remote(
                    318470,
                    &[
                        ("title", json!("Site Title"), later),
                        ("status", json!("wish"), later),
                        ("decision", json!("like"), later),
                        ("engine", json!("Nonsense Engine"), later),
                    ],
                ),
                remote(999, &[("decision", json!("like"), later)]),
            ],
        )
        .unwrap();
        let game = games::get(&conn, id).unwrap().unwrap();
        assert_eq!(game.title, "My Title");
        assert_eq!(game.status, "new");
        assert!(changed, "title counts as applied even when the manual title wins");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn reset_requeues_games_missing_in_cloud_and_never_deletes() {
        let mut conn = db();
        let present = add_game(&conn, "pod", Some(PAGE));
        let missing = add_game(&conn, "other", Some("https://f95zone.to/threads/other.5/"));
        clear(&conn);

        let cloud: HashSet<i64> = [318470].into();
        assert_eq!(missing_in_cloud(&conn, &cloud).unwrap(), vec![missing]);
        assert_eq!(requeue_missing(&mut conn, &cloud).unwrap(), 1);
        assert!(outbox(&conn).iter().all(|(thread, _, _)| *thread == 5));
        assert_eq!(requeue_missing(&mut conn, &cloud).unwrap(), 1, "a half-queued game is re-sent whole");
        assert!(games::get(&conn, present).unwrap().is_some());
        assert!(games::get(&conn, missing).unwrap().is_some());
    }
}
