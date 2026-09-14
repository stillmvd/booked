use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::url_norm::{self, ParsedUrl, UrlError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Platform {
    pub key: &'static str,
    pub name: &'static str,
}

pub const PLATFORM_DOMAINS: &[(&str, &str, &str)] = &[
    ("instagram.com", "instagram", "Instagram"),
    ("instagr.am", "instagram", "Instagram"),
    ("tiktok.com", "tiktok", "TikTok"),
    ("t.me", "telegram", "Telegram"),
    ("telegram.me", "telegram", "Telegram"),
    ("telegram.org", "telegram", "Telegram"),
    ("youtube.com", "youtube", "YouTube"),
    ("youtu.be", "youtube", "YouTube"),
    ("x.com", "x", "X"),
    ("twitter.com", "x", "X"),
    ("vk.com", "vk", "VK"),
    ("vk.ru", "vk", "VK"),
    ("twitch.tv", "twitch", "Twitch"),
    ("kick.com", "kick", "Kick"),
    ("boosty.to", "boosty", "Boosty"),
    ("patreon.com", "patreon", "Patreon"),
    ("pinterest.com", "pinterest", "Pinterest"),
    ("pinterest.ru", "pinterest", "Pinterest"),
    ("pin.it", "pinterest", "Pinterest"),
    ("facebook.com", "facebook", "Facebook"),
    ("fb.com", "facebook", "Facebook"),
    ("threads.net", "threads", "Threads"),
    ("threads.com", "threads", "Threads"),
    ("bsky.app", "bluesky", "Bluesky"),
    ("reddit.com", "reddit", "Reddit"),
    ("tumblr.com", "tumblr", "Tumblr"),
    ("discord.gg", "discord", "Discord"),
    ("discord.com", "discord", "Discord"),
    ("github.com", "github", "GitHub"),
    ("behance.net", "behance", "Behance"),
    ("artstation.com", "artstation", "ArtStation"),
    ("deviantart.com", "deviantart", "DeviantArt"),
    ("onlyfans.com", "onlyfans", "OnlyFans"),
    ("fansly.com", "fansly", "Fansly"),
    ("linktr.ee", "linktree", "Linktree"),
    ("dzen.ru", "dzen", "Дзен"),
    ("rutube.ru", "rutube", "Rutube"),
];

fn bare_host(host: &str) -> String {
    let host = host.trim_end_matches('.').to_lowercase();
    for prefix in ["www.", "m.", "mobile."] {
        if let Some(rest) = host.strip_prefix(prefix) {
            if rest.contains('.') {
                return rest.to_string();
            }
        }
    }
    host
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(bare_host))
}

pub fn platform_for_host(host: &str) -> Option<Platform> {
    let host = bare_host(host);
    PLATFORM_DOMAINS
        .iter()
        .find(|(domain, _, _)| host == *domain || host.ends_with(&format!(".{domain}")))
        .map(|(_, key, name)| Platform { key, name })
}

pub fn platform_for_url(url: &str) -> Option<Platform> {
    host_of(url).and_then(|host| platform_for_host(&host))
}

pub fn display_label(url: &str, label: Option<&str>) -> String {
    if let Some(custom) = label.map(str::trim).filter(|l| !l.is_empty()) {
        return custom.to_string();
    }
    match host_of(url) {
        Some(host) => platform_for_host(&host).map(|p| p.name.to_string()).unwrap_or(host),
        None => url.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: i64,
    pub url: String,
    pub url_normalized: String,
    pub label: Option<String>,
    pub display_label: String,
    pub platform: Option<&'static str>,
    pub link_status: Option<String>,
    pub link_reason: Option<String>,
    pub http_status: Option<i64>,
    pub last_checked_at: Option<i64>,
    pub fail_count: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkInput {
    pub url: String,
    pub label: Option<String>,
}

#[derive(Debug)]
pub enum LinksError {
    Empty,
    BadUrl { position: usize, error: UrlError },
    Db(rusqlite::Error),
}

impl std::fmt::Display for LinksError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LinksError::Empty => write!(f, "у закладки должна остаться хотя бы одна ссылка"),
            LinksError::BadUrl { position, error } => write!(f, "ссылка {position}: {error}"),
            LinksError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl From<rusqlite::Error> for LinksError {
    fn from(e: rusqlite::Error) -> Self {
        LinksError::Db(e)
    }
}

const LINK_COLUMNS: &str = "id, bookmark_id, url, url_normalized, label, link_status, link_reason, \
     http_status, last_checked_at, fail_count";

fn row_to_link(row: &rusqlite::Row) -> rusqlite::Result<(i64, Link)> {
    let url: String = row.get(2)?;
    let label: Option<String> = row.get(4)?;
    Ok((
        row.get(1)?,
        Link {
            id: row.get(0)?,
            display_label: display_label(&url, label.as_deref()),
            platform: platform_for_url(&url).map(|p| p.key),
            url_normalized: row.get(3)?,
            label,
            url,
            link_status: row.get(5)?,
            link_reason: row.get(6)?,
            http_status: row.get(7)?,
            last_checked_at: row.get(8)?,
            fail_count: row.get(9)?,
        },
    ))
}

pub fn list(conn: &Connection, bookmark_id: i64) -> rusqlite::Result<Vec<Link>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LINK_COLUMNS} FROM bookmark_links WHERE bookmark_id = ?1 ORDER BY sort, id"
    ))?;
    let links = stmt
        .query_map(params![bookmark_id], row_to_link)?
        .map(|r| r.map(|(_, link)| link))
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(links)
}

pub fn for_bookmarks(conn: &Connection, ids: &[i64]) -> rusqlite::Result<HashMap<i64, Vec<Link>>> {
    let mut out: HashMap<i64, Vec<Link>> = HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    for chunk in ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let mut stmt = conn.prepare(&format!(
            "SELECT {LINK_COLUMNS} FROM bookmark_links WHERE bookmark_id IN ({placeholders}) \
             ORDER BY bookmark_id, sort, id"
        ))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(chunk.iter()), row_to_link)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (bookmark_id, link) in rows {
            out.entry(bookmark_id).or_default().push(link);
        }
    }
    Ok(out)
}

fn clean_label(label: Option<&str>) -> Option<String> {
    label.map(str::trim).filter(|l| !l.is_empty()).map(str::to_string)
}

pub fn refresh_liveness(conn: &Connection, bookmark_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE bookmarks SET (link_status, link_reason, http_status, last_checked_at, fail_count) = ( \
             SELECT link_status, link_reason, http_status, last_checked_at, fail_count \
             FROM bookmark_links WHERE bookmark_id = ?1 \
             ORDER BY link_status IS NOT 'dead', sort, id \
             LIMIT 1 \
         ) WHERE id = ?1 AND EXISTS (SELECT 1 FROM bookmark_links WHERE bookmark_id = ?1)",
        params![bookmark_id],
    )?;
    Ok(())
}

pub fn refresh_text(conn: &Connection, bookmark_id: i64) -> rusqlite::Result<()> {
    refresh_liveness(conn, bookmark_id)?;
    conn.execute(
        "UPDATE bookmarks SET \
         links_text = COALESCE(( \
             SELECT group_concat(url, ' ') \
             FROM (SELECT url FROM bookmark_links WHERE bookmark_id = ?1 ORDER BY sort, id) \
         ), url), \
         link_labels = COALESCE(( \
             SELECT group_concat(label, ' ') \
             FROM (SELECT label FROM bookmark_links WHERE bookmark_id = ?1 AND label IS NOT NULL ORDER BY sort, id) \
         ), '') \
         WHERE id = ?1",
        params![bookmark_id],
    )?;
    Ok(())
}

pub fn insert_primary(conn: &Connection, bookmark_id: i64, parsed: &ParsedUrl) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO bookmark_links (bookmark_id, sort, url, url_normalized) VALUES (?1, 0, ?2, ?3)",
        params![bookmark_id, parsed.url, parsed.normalized],
    )?;
    refresh_text(conn, bookmark_id)
}

pub fn sync_primary(conn: &Connection, bookmark_id: i64, parsed: &ParsedUrl) -> rusqlite::Result<()> {
    let primary: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, url_normalized FROM bookmark_links WHERE bookmark_id = ?1 ORDER BY sort, id LIMIT 1",
            params![bookmark_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match primary {
        None => insert_primary(conn, bookmark_id, parsed),
        Some((link_id, normalized)) => {
            if normalized == parsed.normalized {
                conn.execute(
                    "UPDATE bookmark_links SET url = ?1 WHERE id = ?2",
                    params![parsed.url, link_id],
                )?;
                return refresh_text(conn, bookmark_id);
            }
            let twin: Option<(i64, Liveness)> = conn
                .query_row(
                    "SELECT id, link_status, link_reason, http_status, last_checked_at, fail_count \
                     FROM bookmark_links WHERE bookmark_id = ?1 AND url_normalized = ?2 AND id <> ?3 \
                     ORDER BY sort, id LIMIT 1",
                    params![bookmark_id, parsed.normalized, link_id],
                    |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))),
                )
                .optional()?;
            let (status, reason, http, checked, fails) = match twin {
                Some((twin_id, liveness)) => {
                    conn.execute("DELETE FROM bookmark_links WHERE id = ?1", params![twin_id])?;
                    liveness
                }
                None => (None, None, None, None, 0),
            };
            conn.execute(
                "UPDATE bookmark_links SET url = ?1, url_normalized = ?2, link_status = ?3, \
                 link_reason = ?4, http_status = ?5, last_checked_at = ?6, fail_count = ?7 WHERE id = ?8",
                params![parsed.url, parsed.normalized, status, reason, http, checked, fails, link_id],
            )?;
            refresh_text(conn, bookmark_id)
        }
    }
}

type Liveness = (Option<String>, Option<String>, Option<i64>, Option<i64>, i64);

pub fn replace_all_tx(conn: &Connection, bookmark_id: i64, inputs: &[LinkInput]) -> Result<(), LinksError> {
    if inputs.is_empty() {
        return Err(LinksError::Empty);
    }
    let mut parsed: Vec<(ParsedUrl, Option<String>)> = Vec::with_capacity(inputs.len());
    for (i, input) in inputs.iter().enumerate() {
        let p = url_norm::parse(&input.url).map_err(|error| LinksError::BadUrl { position: i + 1, error })?;
        if !parsed.iter().any(|(seen, _)| seen.normalized == p.normalized) {
            parsed.push((p, clean_label(input.label.as_deref())));
        }
    }

    let mut previous: HashMap<String, Liveness> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT url_normalized, link_status, link_reason, http_status, last_checked_at, fail_count \
             FROM bookmark_links WHERE bookmark_id = ?1 ORDER BY sort, id",
        )?;
        let rows = stmt
            .query_map(params![bookmark_id], |row| {
                Ok((row.get::<_, String>(0)?, (row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (normalized, liveness) in rows {
            previous.entry(normalized).or_insert(liveness);
        }
    }

    conn.execute("DELETE FROM bookmark_links WHERE bookmark_id = ?1", params![bookmark_id])?;
    for (sort, (p, label)) in parsed.iter().enumerate() {
        let (status, reason, http, checked, fails) =
            previous.get(&p.normalized).cloned().unwrap_or((None, None, None, None, 0));
        conn.execute(
            "INSERT INTO bookmark_links (bookmark_id, sort, url, url_normalized, label, link_status, \
             link_reason, http_status, last_checked_at, fail_count) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![bookmark_id, sort as i64, p.url, p.normalized, label, status, reason, http, checked, fails],
        )?;
    }

    let (first, _) = &parsed[0];
    conn.execute(
        "UPDATE bookmarks SET url = ?1, url_normalized = ?2, updated_at = unixepoch() \
         WHERE id = ?3 AND (url IS NOT ?1 OR url_normalized IS NOT ?2)",
        params![first.url, first.normalized, bookmark_id],
    )?;
    refresh_text(conn, bookmark_id)?;
    Ok(())
}

pub fn url_for_open(conn: &Connection, bookmark_id: i64, link_id: i64) -> Result<String, String> {
    let stored: String = conn
        .query_row(
            "SELECT url FROM bookmark_links WHERE id = ?1 AND bookmark_id = ?2",
            params![link_id, bookmark_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    url_norm::parse(&stored).map(|p| p.url).map_err(|e| e.to_string())
}

pub fn urls_for_open(conn: &Connection, bookmark_id: i64) -> Result<Vec<String>, String> {
    let links = list(conn, bookmark_id).map_err(|e| e.to_string())?;
    if links.is_empty() {
        return crate::bookmarks::url_for_open(conn, bookmark_id).map(|url| vec![url]);
    }
    let urls: Vec<String> = links.iter().filter_map(|link| url_norm::parse(&link.url).ok().map(|p| p.url)).collect();
    if urls.is_empty() {
        return Err(UrlError::UnsupportedScheme.to_string());
    }
    Ok(urls)
}

pub fn repair_primary_links(conn: &Connection) -> rusqlite::Result<usize> {
    let stale: Vec<(i64, String)> = conn
        .prepare(
            "SELECT b.id, b.url FROM bookmarks b              WHERE b.url_normalized IS NOT (                  SELECT l.url_normalized FROM bookmark_links l WHERE l.bookmark_id = b.id ORDER BY l.sort, l.id LIMIT 1              )",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut repaired = 0;
    for (id, url) in stale {
        if let Ok(parsed) = url_norm::parse(&url) {
            sync_primary(conn, id, &parsed)?;
            repaired += 1;
        }
    }
    Ok(repaired)
}

pub fn replace_all(conn: &mut Connection, bookmark_id: i64, inputs: &[LinkInput]) -> Result<(), LinksError> {
    let tx = conn.transaction()?;
    replace_all_tx(&tx, bookmark_id, inputs)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bookmarks;
    use crate::db::migrate;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn create(conn: &Connection, title: &str, url: &str) -> i64 {
        let parsed = url_norm::parse(url).unwrap();
        bookmarks::create(conn, None, title, &parsed, None, None).unwrap()
    }

    fn input(url: &str, label: Option<&str>) -> LinkInput {
        LinkInput { url: url.to_string(), label: label.map(str::to_string) }
    }

    fn fts_ok(conn: &Connection) {
        conn.execute("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('integrity-check')", [])
            .unwrap();
    }

    fn fts_ids(conn: &Connection, query: &str) -> Vec<i64> {
        let mut stmt = conn
            .prepare("SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH ?1 ORDER BY rowid")
            .unwrap();
        stmt.query_map(params![query], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    #[test]
    fn platform_detects_subdomains_and_prefixes() {
        assert_eq!(platform_for_host("www.instagram.com").map(|p| p.key), Some("instagram"));
        assert_eq!(platform_for_host("m.youtube.com").map(|p| p.name), Some("YouTube"));
        assert_eq!(platform_for_host("vm.tiktok.com").map(|p| p.key), Some("tiktok"));
        assert_eq!(platform_for_host("T.ME").map(|p| p.name), Some("Telegram"));
        assert_eq!(platform_for_host("notinstagram.com"), None);
        assert_eq!(platform_for_host("example.org"), None);
    }

    #[test]
    fn display_label_prefers_custom_then_platform_then_host() {
        assert_eq!(display_label("https://t.me/anyaveres", Some("  Личный канал ")), "Личный канал");
        assert_eq!(display_label("https://www.instagram.com/anya.draws", None), "Instagram");
        assert_eq!(display_label("https://www.anyaveres.art/works", Some("   ")), "anyaveres.art");
    }

    #[test]
    fn create_writes_primary_link_and_search_text() {
        let conn = setup();
        let id = create(&conn, "Аня Верес", "https://www.instagram.com/anya.draws/");

        let links = list(&conn, id).unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://www.instagram.com/anya.draws/");
        assert_eq!(links[0].display_label, "Instagram");
        assert_eq!(links[0].platform, Some("instagram"));
        fts_ok(&conn);
    }

    #[test]
    fn replace_all_keeps_order_and_moves_first_link_into_bookmark() {
        let mut conn = setup();
        let id = create(&conn, "Аня Верес", "https://www.instagram.com/anya.draws");

        replace_all(
            &mut conn,
            id,
            &[
                input("https://t.me/anyaveres", Some("Личный канал")),
                input("https://www.instagram.com/anya.draws", None),
                input("https://www.tiktok.com/@anyadraws", None),
            ],
        )
        .unwrap();

        let links = list(&conn, id).unwrap();
        let labels: Vec<&str> = links.iter().map(|l| l.display_label.as_str()).collect();
        assert_eq!(labels, ["Личный канал", "Instagram", "TikTok"]);
        let (url, normalized): (String, String) = conn
            .query_row("SELECT url, url_normalized FROM bookmarks WHERE id = ?1", params![id], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(url, "https://t.me/anyaveres");
        assert_eq!(normalized, "https://t.me/anyaveres");
        fts_ok(&conn);
    }

    #[test]
    fn replace_all_rejects_empty_list_and_bad_url_without_changes() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");

        assert!(matches!(replace_all(&mut conn, id, &[]), Err(LinksError::Empty)));
        let err = replace_all(
            &mut conn,
            id,
            &[input("https://t.me/anyaveres", None), input("javascript:alert(1)", None)],
        )
        .unwrap_err();
        assert!(matches!(err, LinksError::BadUrl { position: 2, error: UrlError::UnsupportedScheme }));

        let links = list(&conn, id).unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://www.instagram.com/anya.draws");
    }

    #[test]
    fn replace_all_keeps_liveness_of_unchanged_addresses_only() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(
            &mut conn,
            id,
            &[input("https://www.instagram.com/anya.draws", None), input("https://youtube.com/@anyadraws", None)],
        )
        .unwrap();
        conn.execute(
            "UPDATE bookmark_links SET link_status = 'dead', http_status = 404, fail_count = 3, last_checked_at = 100 \
             WHERE url_normalized = 'https://youtube.com/@anyadraws'",
            [],
        )
        .unwrap();

        replace_all(
            &mut conn,
            id,
            &[
                input("https://www.youtube.com/@anyadraws/", None),
                input("https://www.tiktok.com/@anyadraws", None),
                input("https://instagram.com/anya.draws", None),
            ],
        )
        .unwrap();

        let links = list(&conn, id).unwrap();
        assert_eq!(links[0].link_status.as_deref(), Some("dead"));
        assert_eq!(links[0].fail_count, 3);
        assert_eq!(links[1].link_status, None);
        assert_eq!(links[2].link_status, None);
    }

    #[test]
    fn search_finds_bookmark_by_second_link_and_cyrillic_label() {
        let mut conn = setup();
        let id = create(&conn, "Аня Верес", "https://www.instagram.com/anya.draws");
        let other = create(&conn, "Другое", "https://example.org/page");
        replace_all(
            &mut conn,
            id,
            &[input("https://www.instagram.com/anya.draws", None), input("https://t.me/anyaveres", Some("Личный Канал"))],
        )
        .unwrap();

        assert_eq!(fts_ids(&conn, "anyaveres*"), vec![id]);
        assert_eq!(fts_ids(&conn, "личный"), vec![id]);
        assert_eq!(fts_ids(&conn, "example*"), vec![other]);

        replace_all(&mut conn, id, &[input("https://www.instagram.com/anya.draws", None)]).unwrap();
        assert!(fts_ids(&conn, "anyaveres*").is_empty());
        fts_ok(&conn);
    }

    #[test]
    fn sync_primary_updates_first_link_and_resets_status_when_address_changes() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(
            &mut conn,
            id,
            &[input("https://www.instagram.com/anya.draws", None), input("https://t.me/anyaveres", None)],
        )
        .unwrap();
        conn.execute("UPDATE bookmark_links SET link_status = 'dead' WHERE bookmark_id = ?1", params![id]).unwrap();

        let same = url_norm::parse("https://instagram.com/anya.draws/").unwrap();
        bookmarks::update(&conn, id, None, "Аня", &same, None, None).unwrap();
        let links = list(&conn, id).unwrap();
        assert_eq!(links[0].url, "https://instagram.com/anya.draws/");
        assert_eq!(links[0].link_status.as_deref(), Some("dead"));

        let moved = url_norm::parse("https://www.tiktok.com/@anyadraws").unwrap();
        bookmarks::update(&conn, id, None, "Аня", &moved, None, None).unwrap();
        let links = list(&conn, id).unwrap();
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].url_normalized, "https://tiktok.com/@anyadraws");
        assert_eq!(links[0].link_status, None);
        assert_eq!(links[1].link_status.as_deref(), Some("dead"));
        fts_ok(&conn);
    }

    #[test]
    fn swapping_first_two_links_through_update_then_replace_all_keeps_liveness_of_both() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(
            &mut conn,
            id,
            &[input("https://www.instagram.com/anya.draws", None), input("https://t.me/anyaveres", Some("Канал"))],
        )
        .unwrap();
        conn.execute(
            "UPDATE bookmark_links SET link_status = 'dead', link_reason = 'not_found', http_status = 404, \
             fail_count = 3, last_checked_at = 100 WHERE url_normalized = 'https://instagram.com/anya.draws'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE bookmark_links SET link_status = 'alive', http_status = 200, fail_count = 0, last_checked_at = 200 \
             WHERE url_normalized = 'https://t.me/anyaveres'",
            [],
        )
        .unwrap();

        let old_primary: String =
            conn.query_row("SELECT url FROM bookmarks WHERE id = ?1", params![id], |row| row.get(0)).unwrap();
        let old_primary = url_norm::parse(&old_primary).unwrap();
        bookmarks::update(&conn, id, None, "Аня Верес", &old_primary, None, None).unwrap();
        replace_all(
            &mut conn,
            id,
            &[input("https://t.me/anyaveres", Some("Канал")), input("https://www.instagram.com/anya.draws", None)],
        )
        .unwrap();

        let links = list(&conn, id).unwrap();
        assert_eq!(links[0].url_normalized, "https://t.me/anyaveres");
        assert_eq!(links[0].link_status.as_deref(), Some("alive"));
        assert_eq!(links[0].last_checked_at, Some(200));
        assert_eq!(links[1].url_normalized, "https://instagram.com/anya.draws");
        assert_eq!(links[1].link_status.as_deref(), Some("dead"));
        assert_eq!(links[1].http_status, Some(404));
        assert_eq!(links[1].fail_count, 3);
        assert_eq!(links[1].last_checked_at, Some(100));
        let (url, status): (String, Option<String>) = conn
            .query_row("SELECT url, link_status FROM bookmarks WHERE id = ?1", params![id], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(url, "https://t.me/anyaveres");
        assert_eq!(status.as_deref(), Some("dead"));
        fts_ok(&conn);
    }

    #[test]
    fn repair_restores_primary_link_for_rows_written_by_older_version() {
        let mut conn = setup();
        let kept = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(&mut conn, kept, &[input("https://www.instagram.com/anya.draws", None), input("https://t.me/anyaveres", None)])
            .unwrap();
        let old = url_norm::parse("https://example.org/Кот").unwrap();
        conn.execute(
            "INSERT INTO bookmarks (folder_id, title, url, url_normalized) VALUES (NULL, 'Старая версия', ?1, ?2)",
            params![old.url, old.normalized],
        )
        .unwrap();
        let orphan = conn.last_insert_rowid();
        let moved = create(&conn, "Мира", "https://github.com/mira");
        conn.execute(
            "UPDATE bookmarks SET url = 'https://x.com/mira', url_normalized = 'https://x.com/mira' WHERE id = ?1",
            params![moved],
        )
        .unwrap();

        assert_eq!(repair_primary_links(&conn).unwrap(), 2);
        assert_eq!(repair_primary_links(&conn).unwrap(), 0);

        let orphan_links = list(&conn, orphan).unwrap();
        assert_eq!(orphan_links.len(), 1);
        assert_eq!(orphan_links[0].url, "https://example.org/Кот");
        let moved_links = list(&conn, moved).unwrap();
        assert_eq!(moved_links.len(), 1);
        assert_eq!(moved_links[0].url_normalized, "https://x.com/mira");
        assert_eq!(list(&conn, kept).unwrap().len(), 2);
        assert_eq!(fts_ids(&conn, "example*"), vec![orphan]);
        fts_ok(&conn);
    }

    #[test]
    fn replace_all_collapses_repeated_address_keeping_first_label() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(
            &mut conn,
            id,
            &[
                input("https://t.me/anyaveres", Some("Канал")),
                input("https://www.instagram.com/anya.draws", None),
                input("https://T.me/anyaveres/", Some("Повтор")),
            ],
        )
        .unwrap();

        let labels: Vec<String> = list(&conn, id).unwrap().into_iter().map(|l| l.display_label).collect();
        assert_eq!(labels, ["Канал", "Instagram"]);
        fts_ok(&conn);
    }

    #[test]
    fn sync_primary_onto_existing_secondary_address_merges_rows_and_keeps_its_status() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(
            &mut conn,
            id,
            &[
                input("https://www.instagram.com/anya.draws", None),
                input("https://t.me/anyaveres", Some("Канал")),
                input("https://www.tiktok.com/@anyadraws", None),
            ],
        )
        .unwrap();
        conn.execute(
            "UPDATE bookmark_links SET link_status = 'dead', fail_count = 2 WHERE url_normalized = 'https://t.me/anyaveres'",
            [],
        )
        .unwrap();

        let onto_secondary = url_norm::parse("https://t.me/anyaveres/").unwrap();
        bookmarks::update(&conn, id, None, "Аня", &onto_secondary, None, None).unwrap();

        let links = list(&conn, id).unwrap();
        let urls: Vec<&str> = links.iter().map(|l| l.url_normalized.as_str()).collect();
        assert_eq!(urls, ["https://t.me/anyaveres", "https://tiktok.com/@anyadraws"]);
        assert_eq!(links[0].link_status.as_deref(), Some("dead"));
        assert_eq!(links[0].fail_count, 2);
        fts_ok(&conn);
    }

    #[test]
    fn deleting_bookmark_removes_links_and_keeps_index_consistent() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(
            &mut conn,
            id,
            &[input("https://www.instagram.com/anya.draws", None), input("https://t.me/anyaveres", None)],
        )
        .unwrap();

        bookmarks::delete(&conn, id).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmark_links WHERE bookmark_id = ?1", params![id], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(fts_ids(&conn, "anyaveres*").is_empty());
        fts_ok(&conn);
    }

    #[test]
    fn url_for_open_refuses_link_of_another_bookmark_and_non_http_address() {
        let mut conn = setup();
        let anya = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        let other = create(&conn, "Другое", "https://example.org");
        replace_all(&mut conn, anya, &[input("https://www.instagram.com/anya.draws", None), input("https://t.me/anyaveres", None)])
            .unwrap();
        let links = list(&conn, anya).unwrap();

        assert_eq!(url_for_open(&conn, anya, links[1].id).unwrap(), "https://t.me/anyaveres");
        assert!(url_for_open(&conn, other, links[1].id).is_err());

        conn.execute("UPDATE bookmark_links SET url = 'javascript:alert(1)' WHERE id = ?1", params![links[1].id]).unwrap();
        assert_eq!(url_for_open(&conn, anya, links[1].id).unwrap_err(), UrlError::UnsupportedScheme.to_string());
        assert_eq!(urls_for_open(&conn, anya).unwrap(), ["https://www.instagram.com/anya.draws"]);
    }

    #[test]
    fn urls_for_open_lists_every_link_in_order() {
        let mut conn = setup();
        let id = create(&conn, "Аня", "https://www.instagram.com/anya.draws");
        replace_all(&mut conn, id, &[input("https://t.me/anyaveres", None), input("https://www.instagram.com/anya.draws", None)])
            .unwrap();
        assert_eq!(urls_for_open(&conn, id).unwrap(), ["https://t.me/anyaveres", "https://www.instagram.com/anya.draws"]);
    }

    #[test]
    fn for_bookmarks_groups_links_by_bookmark_in_order() {
        let mut conn = setup();
        let a = create(&conn, "A", "https://a.example/1");
        let b = create(&conn, "B", "https://b.example/1");
        replace_all(&mut conn, a, &[input("https://a.example/2", None), input("https://a.example/1", None)]).unwrap();

        let map = for_bookmarks(&conn, &[a, b]).unwrap();
        let a_urls: Vec<&str> = map[&a].iter().map(|l| l.url.as_str()).collect();
        assert_eq!(a_urls, ["https://a.example/2", "https://a.example/1"]);
        assert_eq!(map[&b].len(), 1);
    }
}
