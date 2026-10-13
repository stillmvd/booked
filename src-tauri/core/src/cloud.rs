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
        ("decision", SqlValue::Text(decision)) => match decision.as_str() {
            "like" | "dislike" => Some(json!(decision)),
            _ => None,
        },
        ("decision", SqlValue::Null) => Some(Value::Null),
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
            let Some(status) = value.as_str().filter(|s| games::STATUSES.contains(s)) else {
                return Ok(false);
            };
            let applied = conn.execute(
                "UPDATE games SET status = ?1, updated_at = unixepoch() \
                 WHERE id = ?2 AND (?1 != 'wish' OR folder_path IS NULL)",
                params![status, id],
            )?;
            return Ok(applied > 0);
        }
        "cover" => {
            let Some(url) = value.as_str() else {
                return Ok(false);
            };
            let applied = conn.execute(
                "UPDATE games SET cover_url = ?1 WHERE id = ?2 AND folder_path IS NULL",
                params![url, id],
            )?;
            return Ok(applied > 0);
        }
        "rating" => {
            let Some(rating) = value.as_i64().filter(|r| (0..=5).contains(r)) else {
                return Ok(false);
            };
            games::set_rating(conn, id, rating)?;
        }
        "devStatus" => {
            let dev_status = value.as_str().map(str::trim).filter(|v| !v.is_empty());
            conn.execute("UPDATE games SET dev_status = ?1 WHERE id = ?2", params![dev_status, id])?;
        }
        "links" => {
            let Some(links) = games::download_links_of(value) else {
                return Ok(false);
            };
            conn.execute("UPDATE games SET download_links = ?1 WHERE id = ?2", params![links_json(&links), id])?;
        }
        "size" => {
            let Some(size) = value.as_i64().filter(|s| *s >= 0) else {
                return Ok(false);
            };
            let applied = conn.execute(
                "UPDATE games SET size_bytes = ?1 WHERE id = ?2 AND folder_path IS NULL",
                params![size, id],
            )?;
            return Ok(applied > 0);
        }
        _ => return Ok(false),
    }
    Ok(true)
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Incoming {
    pub changed: bool,
}

fn liked_after_delete(game: &RemoteGame) -> Option<&RemoteField> {
    game.doc
        .get("decision")
        .filter(|decision| decision.v.as_str() == Some("like"))
        .filter(|decision| game.deleted_at.is_none_or(|deleted| decision.at > deleted))
}

fn links_json(links: &[games::DownloadLink]) -> Option<String> {
    if links.is_empty() {
        return None;
    }
    serde_json::to_string(links).ok()
}

fn cover_of(game: &RemoteGame) -> Option<String> {
    game.doc.get("cover").and_then(|cover| cover.v.as_str()).map(str::to_string)
}

fn create_wish(conn: &Connection, game: &RemoteGame) -> rusqlite::Result<()> {
    let text = |field: &str| {
        game.doc
            .get(field)
            .and_then(|f| f.v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    let title = text("title").unwrap_or_else(|| format!("Тред {}", game.id));
    let engine = text("engine").as_deref().and_then(games::engine_label).unwrap_or(games::ENGINE_UNKNOWN);
    let size = game.doc.get("size").and_then(|f| f.v.as_i64()).filter(|s| *s >= 0);
    let links = game.doc.get("links").and_then(|f| games::download_links_of(&f.v)).and_then(|links| links_json(&links));
    let times: Map<String, Value> = game.doc.iter().map(|(field, f)| (field.clone(), json!(f.at))).collect();
    let base = games::unique_base(conn, &format!("f95-{}", game.id))?;
    conn.execute(
        "INSERT INTO games (base_name, title, title_source, source, page_url, site_version, seen_version, \
         engine, dev_status, size_bytes, status, f95_thread_id, field_at, cover_url, download_links) \
         VALUES (?1, ?2, 'site', 'f95', ?3, ?4, ?4, ?5, ?6, ?7, 'wish', ?8, ?9, ?10, ?11)",
        params![
            base,
            title,
            format!("https://f95zone.to/threads/{}/", game.id),
            text("siteVersion"),
            engine,
            text("devStatus"),
            size,
            game.id,
            Value::Object(times).to_string(),
            cover_of(game),
            links
        ],
    )?;
    Ok(())
}

pub fn apply_incoming(conn: &mut Connection, remote: &[RemoteGame]) -> rusqlite::Result<Incoming> {
    let tx = conn.transaction()?;
    let before: i64 = tx.query_row("SELECT COALESCE(MAX(id), 0) FROM sync_outbox", [], |row| row.get(0))?;
    let mut out = Incoming::default();
    let mut revived: Vec<(i64, i64)> = Vec::new();
    for game in remote {
        let local: Option<(i64, Option<String>, bool)> = tx
            .query_row(
                "SELECT id, field_at, status = 'wish' AND folder_path IS NULL FROM games WHERE f95_thread_id = ?1",
                params![game.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((id, times, wish)) = local else {
            let decided_here: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE thread_id = ?1 AND field IN ('decision', 'deleted') AND id <= ?2)",
                params![game.id, before],
                |row| row.get(0),
            )?;
            if let (Some(decision), false) = (liked_after_delete(game), decided_here) {
                create_wish(&tx, game)?;
                if let Some(deleted) = game.deleted_at {
                    revived.push((game.id, now_ms().max(decision.at).max(deleted + 1)));
                }
                out.changed = true;
            }
            continue;
        };
        let mut times = field_times(times.as_deref());
        let newer = |times: &Map<String, Value>, field: &str| {
            game.doc
                .get(field)
                .filter(|f| f.at > times.get(field).and_then(Value::as_i64).unwrap_or(0))
        };
        let undecided = newer(&times, "decision").is_some_and(|d| d.v.as_str() != Some("like"));
        if wish && (undecided || (game.deleted_at.is_some() && liked_after_delete(game).is_none())) {
            tx.execute("DELETE FROM games WHERE id = ?1", params![id])?;
            out.changed = true;
            continue;
        }
        if game.deleted_at.is_some() {
            continue;
        }
        let mut touched = false;
        let mut fields: Vec<(&String, &RemoteField)> = game.doc.iter().collect();
        fields.sort_by(|a, b| a.0.cmp(b.0));
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
        }
        out.changed |= touched;
    }
    tx.execute("DELETE FROM sync_outbox WHERE id > ?1", params![before])?;
    for (thread, at) in revived {
        tx.execute(
            "INSERT INTO sync_outbox (thread_id, field, value, at) VALUES (?1, 'deleted', 0, ?2)",
            params![thread, at],
        )?;
    }
    tx.commit()?;
    Ok(out)
}

fn wish_thread(conn: &Connection, id: i64) -> rusqlite::Result<Option<Option<i64>>> {
    conn.query_row(
        "SELECT f95_thread_id FROM games WHERE id = ?1 AND status = 'wish' AND folder_path IS NULL",
        params![id],
        |row| row.get(0),
    )
    .optional()
}

pub fn remove_wish(conn: &mut Connection, id: i64) -> rusqlite::Result<bool> {
    let tx = conn.transaction()?;
    let Some(thread) = wish_thread(&tx, id)? else {
        return Ok(false);
    };
    if let Some(thread) = thread {
        tx.execute(
            "INSERT INTO sync_outbox (thread_id, field, value, at) VALUES (?1, 'decision', NULL, ?2)",
            params![thread, now_ms()],
        )?;
    }
    tx.execute("DELETE FROM games WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(true)
}

pub fn dislike_wish(conn: &mut Connection, id: i64) -> rusqlite::Result<bool> {
    let tx = conn.transaction()?;
    let Some(thread) = wish_thread(&tx, id)? else {
        return Ok(false);
    };
    if let Some(thread) = thread {
        tx.execute(
            "INSERT INTO sync_outbox (thread_id, field, value, at) VALUES (?1, 'decision', 'dislike', ?2)",
            params![thread, now_ms()],
        )?;
    }
    tx.execute("UPDATE games SET f95_thread_id = NULL WHERE id = ?1", params![id])?;
    tx.execute("DELETE FROM games WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(true)
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
        .unwrap()
        .changed;
        assert!(changed);
        let game = games::get(&conn, id).unwrap().unwrap();
        assert_eq!(game.rating, 4);
        assert_eq!(game.status, "disliked");
        assert!(outbox(&conn).is_empty());
        assert_eq!(field_at(&conn, id).get("rating").and_then(Value::as_i64), Some(later));
    }

    #[test]
    fn unban_in_the_extension_turns_disliked_into_waiting() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        games::set_status(&conn, id, "disliked").unwrap();
        clear(&conn);

        let later = now_ms() + 60_000;
        assert!(apply_incoming(&mut conn, &[remote(318470, &[("status", json!("waiting"), later)])]).unwrap().changed);
        assert_eq!(games::get(&conn, id).unwrap().unwrap().status, "waiting");
        assert!(outbox(&conn).is_empty());
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
                remote(999, &[("decision", json!("dislike"), later), ("tags", json!(["3DCG"]), later)]),
            ],
        )
        .unwrap()
        .changed;
        let game = games::get(&conn, id).unwrap().unwrap();
        assert_eq!(game.title, "My Title");
        assert_eq!(game.status, "new");
        assert!(changed, "title counts as applied even when the manual title wins");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    fn liked(id: i64, at: i64) -> RemoteGame {
        remote(
            id,
            &[
                ("decision", json!("like"), at),
                ("title", json!("Path of Desire"), at),
                ("siteVersion", json!("0.6.2"), at),
                ("engine", json!("renpy"), at),
                ("devStatus", json!("Ongoing"), at),
                ("size", json!(1_500_000_000_i64), at),
                ("cover", json!("https://attachments.f95zone.to/2024/01/pod.webp"), at),
                ("tags", json!(["3DCG", "Sandbox"]), at),
            ],
        )
    }

    fn wish_of(conn: &Connection, thread: i64) -> Option<games::Game> {
        let id: Option<i64> = conn
            .query_row("SELECT id FROM games WHERE f95_thread_id = ?1", params![thread], |row| row.get(0))
            .optional()
            .unwrap();
        id.and_then(|id| games::get(conn, id).unwrap())
    }

    fn link(host: &str, url: &str) -> games::DownloadLink {
        games::DownloadLink { host: host.into(), url: url.into() }
    }

    #[test]
    fn like_with_links_keeps_them_in_thread_order() {
        let mut conn = db();
        let at = now_ms();
        let mut game = liked(318470, at);
        let links = json!([
            { "host": "MEGA", "url": "https://f95zone.to/masked/mega.nz/2/1/abc" },
            { "host": "DATANODES", "url": "https://datanodes.to/x1" },
        ]);
        game.doc.insert("links".into(), RemoteField { v: links, at });
        apply_incoming(&mut conn, &[game]).unwrap();
        assert_eq!(
            wish_of(&conn, 318470).unwrap().download_links,
            vec![link("MEGA", "https://f95zone.to/masked/mega.nz/2/1/abc"), link("DATANODES", "https://datanodes.to/x1")]
        );
    }

    #[test]
    fn newer_links_replace_older_and_empty_list_clears() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        let at = now_ms();
        let first = json!([{ "host": "MIXDROP", "url": "https://mixdrop.ag/f/1" }]);
        apply_incoming(&mut conn, &[remote(318470, &[("links", first, at)])]).unwrap();
        assert_eq!(games::get(&conn, id).unwrap().unwrap().download_links, vec![link("MIXDROP", "https://mixdrop.ag/f/1")]);

        let stale = json!([{ "host": "MEGA", "url": "https://mega.nz/old" }]);
        apply_incoming(&mut conn, &[remote(318470, &[("links", stale, at - 1)])]).unwrap();
        assert_eq!(games::get(&conn, id).unwrap().unwrap().download_links.len(), 1);
        assert_eq!(games::get(&conn, id).unwrap().unwrap().download_links[0].host, "MIXDROP");

        apply_incoming(&mut conn, &[remote(318470, &[("links", json!([]), at + 1)])]).unwrap();
        assert!(games::get(&conn, id).unwrap().unwrap().download_links.is_empty());
        assert!(outbox(&conn).iter().all(|(_, field, _)| field != "links"));
    }

    #[test]
    fn broken_links_are_ignored() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        let at = now_ms();
        for bad in [
            json!([{ "host": "MEGA", "url": "http://mega.nz/a" }]),
            json!([{ "host": "", "url": "https://mega.nz/a" }]),
            json!([{ "host": "MEGA", "url": "https://mega.nz/a", "extra": 1 }]),
            json!({ "host": "MEGA", "url": "https://mega.nz/a" }),
            json!((0..13).map(|i| json!({ "host": "MEGA", "url": format!("https://mega.nz/{i}") })).collect::<Vec<_>>()),
        ] {
            apply_incoming(&mut conn, &[remote(318470, &[("links", bad, at)])]).unwrap();
            assert!(games::get(&conn, id).unwrap().unwrap().download_links.is_empty());
        }
    }

    #[test]
    fn like_creates_one_wish_card_with_site_fields_and_no_tags() {
        let mut conn = db();
        let at = now_ms();
        let first = apply_incoming(&mut conn, &[liked(318470, at)]).unwrap();
        assert!(first.changed);
        let game = wish_of(&conn, 318470).unwrap();
        assert_eq!(
            games::missing_covers(&conn).unwrap(),
            vec![(game.id, "https://attachments.f95zone.to/2024/01/pod.webp".to_string())]
        );
        assert_eq!(game.status, "wish");
        assert_eq!(game.folder_path, None);
        assert_eq!(game.title, "Path of Desire");
        assert_eq!(game.site_version.as_deref(), Some("0.6.2"));
        assert_eq!(game.engine.as_deref(), Some("Ren'Py"));
        assert_eq!(game.dev_status.as_deref(), Some("Ongoing"));
        assert_eq!(game.size_bytes, Some(1_500_000_000));
        assert_eq!(game.page_url.as_deref(), Some("https://f95zone.to/threads/318470/"));
        assert_eq!(game.source.as_deref(), Some("f95"));
        assert!(game.tags.is_empty());
        assert!(!game.has_update);
        assert!(outbox(&conn).is_empty());
        let tags: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0)).unwrap();
        assert_eq!(tags, 0);

        let again = apply_incoming(&mut conn, &[liked(318470, at)]).unwrap();
        assert!(!again.changed);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn like_for_a_thread_already_in_booked_creates_nothing() {
        let mut conn = db();
        let id = add_game(&conn, "pod", Some(PAGE));
        clear(&conn);
        apply_incoming(&mut conn, &[liked(318470, now_ms() + 60_000)]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
        let game = games::get(&conn, id).unwrap().unwrap();
        assert_eq!(game.status, "new");
        assert_eq!(game.dev_status.as_deref(), Some("Ongoing"));
        assert_eq!(game.size_bytes, None, "size from the site never replaces a folder");
        assert!(outbox(&conn).is_empty());
    }

    #[test]
    fn like_newer_than_delete_revives_the_row() {
        let mut conn = db();
        let mut game = liked(318470, 2_000);
        game.deleted_at = Some(1_000);
        apply_incoming(&mut conn, &[game]).unwrap();
        assert!(wish_of(&conn, 318470).is_some());
        let items = pending(&conn).unwrap();
        assert_eq!(items.len(), 1);
        let wire = items[0].wire.clone().unwrap();
        assert_eq!((wire.field.as_str(), wire.v.clone()), ("deleted", json!(false)));
        assert!(wire.at > 1_000);
    }

    #[test]
    fn delete_newer_than_like_creates_nothing() {
        let mut conn = db();
        let mut game = liked(318470, 1_000);
        game.deleted_at = Some(2_000);
        apply_incoming(&mut conn, &[game]).unwrap();
        assert!(wish_of(&conn, 318470).is_none());
        assert!(outbox(&conn).is_empty());
    }

    #[test]
    fn decision_changed_elsewhere_removes_the_wish_card_without_echo() {
        let mut conn = db();
        apply_incoming(&mut conn, &[liked(318470, 1_000)]).unwrap();
        let changed = apply_incoming(&mut conn, &[remote(318470, &[("decision", Value::Null, 2_000)])]).unwrap();
        assert!(changed.changed);
        assert!(wish_of(&conn, 318470).is_none());
        assert!(outbox(&conn).is_empty());
    }

    #[test]
    fn cover_arrives_later_only_for_a_bare_card() {
        let mut conn = db();
        let at = now_ms();
        let mut game = liked(318470, at);
        game.doc.remove("cover");
        apply_incoming(&mut conn, &[game]).unwrap();
        let id = wish_of(&conn, 318470).unwrap().id;
        assert!(games::missing_covers(&conn).unwrap().is_empty());
        let cover = "https://attachments.f95zone.to/2024/02/new.webp";
        apply_incoming(&mut conn, &[remote(318470, &[("cover", json!(cover), at + 1)])]).unwrap();
        assert_eq!(games::missing_covers(&conn).unwrap(), vec![(id, cover.to_string())]);

        add_game(&conn, "other", Some("https://f95zone.to/threads/other.5/"));
        apply_incoming(&mut conn, &[remote(5, &[("cover", json!(cover), at + 1)])]).unwrap();
        assert_eq!(games::missing_covers(&conn).unwrap().len(), 1, "a card with a folder keeps its own cover");

        assert!(games::set_missing_image(&conn, id, "cover.webp").unwrap());
        assert!(!games::set_missing_image(&conn, id, "other.webp").unwrap());
        assert!(games::missing_covers(&conn).unwrap().is_empty());
    }

    #[test]
    fn decision_still_queued_here_blocks_recreating_the_card() {
        let mut conn = db();
        apply_incoming(&mut conn, &[liked(1, 1_000)]).unwrap();
        let id = wish_of(&conn, 1).unwrap().id;
        remove_wish(&mut conn, id).unwrap();
        apply_incoming(&mut conn, &[liked(1, 1_000)]).unwrap();
        assert!(wish_of(&conn, 1).is_none(), "the cloud has not seen «Убрать» yet");
    }

    #[test]
    fn wish_card_leaves_when_the_cloud_row_is_deleted_after_the_like() {
        let mut conn = db();
        apply_incoming(&mut conn, &[liked(1, 1_000)]).unwrap();
        let mut gone = remote(1, &[("decision", Value::Null, 1_000)]);
        gone.deleted_at = Some(2_000);
        assert!(apply_incoming(&mut conn, &[gone]).unwrap().changed);
        assert!(wish_of(&conn, 1).is_none());
        assert!(outbox(&conn).is_empty());
    }

    #[test]
    fn remove_and_dislike_send_the_right_decision() {
        let mut conn = db();
        apply_incoming(&mut conn, &[liked(1, 1_000), liked(2, 1_000)]).unwrap();
        let removed = wish_of(&conn, 1).unwrap().id;
        let disliked = wish_of(&conn, 2).unwrap().id;

        assert!(remove_wish(&mut conn, removed).unwrap());
        assert!(dislike_wish(&mut conn, disliked).unwrap());
        assert!(wish_of(&conn, 1).is_none());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);

        let wire: Vec<(i64, String, Value)> =
            wire_of(&pending(&conn).unwrap()).into_iter().map(|w| (w.id, w.field, w.v)).collect();
        assert_eq!(
            wire,
            vec![
                (1, "decision".to_string(), Value::Null),
                (1, "deleted".to_string(), json!(true)),
                (2, "decision".to_string(), json!("dislike")),
            ]
        );

        let folder_card = add_game(&conn, "pod", Some(PAGE));
        assert!(!remove_wish(&mut conn, folder_card).unwrap());
        assert!(!dislike_wish(&mut conn, folder_card).unwrap());
        assert!(games::get(&conn, folder_card).unwrap().is_some());
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
