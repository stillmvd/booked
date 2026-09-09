use std::cmp::Ordering;

use rusqlite::{params, Connection, OptionalExtension};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

const PLATFORM_SUFFIXES: &[&str] = &[
    "pc",
    "win",
    "win32",
    "win64",
    "windows",
    "mac",
    "macos",
    "osx",
    "linux",
    "android",
    "compressed",
    "uncensored",
];

const EXE_SKIP_PARTS: &[&str] = &[
    "unins",
    "setup",
    "install",
    "vcredist",
    "directx",
    "dxwebsetup",
    "oalinst",
    "crashhandler",
    "crash_handler",
    "crash-handler",
    "crashreport",
    "python",
    "pythonw",
    "notification_helper",
    "zsync",
];

const EXE_SKIP_ANYWHERE: &[&str] = &["crashhandler", "crashreport"];

const MONTHS: &[(&str, u32)] = &[
    ("jan", 1),
    ("feb", 2),
    ("mar", 3),
    ("apr", 4),
    ("may", 5),
    ("jun", 6),
    ("jul", 7),
    ("aug", 8),
    ("sep", 9),
    ("oct", 10),
    ("nov", 11),
    ("dec", 12),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    F95,
    Itch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedFolder {
    pub title: String,
    pub base_name: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExeCandidate {
    pub path: String,
    pub size: u64,
    pub depth: u8,
}

pub fn parse_folder_name(name: &str) -> ParsedFolder {
    let mut tokens: Vec<&str> = name
        .split(|c: char| c == '-' || c == '_' || c.is_whitespace())
        .filter(|t| !t.is_empty())
        .collect();

    while tokens.len() > 1 {
        let last = tokens[tokens.len() - 1].to_lowercase();
        if PLATFORM_SUFFIXES.contains(&last.as_str()) {
            tokens.pop();
        } else {
            break;
        }
    }

    let version_at = tokens.iter().rposition(|t| is_version_token(t));
    let version = version_at.map(|i| strip_version_prefix(tokens[i]).to_string());
    let word_at = version_at
        .filter(|i| *i > 0)
        .filter(|i| is_version_word(tokens[i - 1]))
        .map(|i| i - 1);

    let without_version: Vec<&str> = tokens
        .iter()
        .enumerate()
        .filter(|(i, _)| Some(*i) != version_at && Some(*i) != word_at)
        .map(|(_, t)| *t)
        .collect();
    let name_tokens = if without_version.is_empty() { tokens.clone() } else { without_version };

    let title = name_tokens
        .iter()
        .map(|t| split_camel(t))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    let base = normalize_base(&name_tokens.join(""));

    ParsedFolder {
        base_name: if base.is_empty() { name.trim().to_lowercase() } else { base },
        title: if title.is_empty() { name.trim().to_string() } else { title },
        version,
    }
}

pub fn normalize_base(raw: &str) -> String {
    raw.chars()
        .flat_map(|c| c.to_lowercase())
        .filter(|c| c.is_alphanumeric())
        .collect()
}

pub fn looks_like_version(raw: &str) -> bool {
    let trimmed = raw.trim();
    !trimmed.is_empty()
        && trimmed.starts_with(|c: char| c.is_ascii_digit())
        && trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

pub fn split_camel(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    let mut out = String::with_capacity(token.len() + 4);
    for (i, c) in chars.iter().enumerate() {
        let prev = if i == 0 { None } else { Some(chars[i - 1]) };
        let next = chars.get(i + 1).copied();
        let boundary = match (prev, next) {
            (Some(p), _) if c.is_uppercase() && p.is_lowercase() => true,
            (Some(p), Some(n)) if c.is_uppercase() && p.is_uppercase() && n.is_lowercase() => true,
            (Some(p), _) if c.is_numeric() && p.is_alphabetic() => true,
            _ => false,
        };
        if boundary {
            out.push(' ');
        }
        out.push(*c);
    }
    out
}

const BRACKETS: &[char] = &['[', ']', '(', ')', '{', '}'];

fn unwrap_brackets(token: &str) -> &str {
    token.trim().trim_matches(|c: char| BRACKETS.contains(&c))
}

fn strip_version_prefix(token: &str) -> &str {
    let trimmed = unwrap_brackets(token);
    let lower = trimmed.to_ascii_lowercase();
    for word in ["version", "ver", "v"] {
        if let Some(rest) = lower.strip_prefix(word) {
            let rest = rest.strip_prefix('.').unwrap_or(rest);
            if rest.starts_with(|c: char| c.is_ascii_digit()) {
                return &trimmed[trimmed.len() - rest.len()..];
            }
        }
    }
    trimmed
}

fn is_version_word(token: &str) -> bool {
    let word = unwrap_brackets(token).trim_end_matches('.').to_ascii_lowercase();
    matches!(word.as_str(), "v" | "ver" | "version" | "версия")
}

pub fn is_version_token(token: &str) -> bool {
    let candidate = strip_version_prefix(token);
    if !candidate.starts_with(|c: char| c.is_ascii_digit()) {
        return false;
    }
    if !candidate
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.')
    {
        return false;
    }
    candidate.contains('.') || candidate.len() != unwrap_brackets(token).len()
}

pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let mut left = a.split('.');
    let mut right = b.split('.');
    loop {
        match (left.next(), right.next()) {
            (None, None) => return Ordering::Equal,
            (Some(l), None) => {
                if segment_is_zero(l) {
                    continue;
                }
                return Ordering::Greater;
            }
            (None, Some(r)) => {
                if segment_is_zero(r) {
                    continue;
                }
                return Ordering::Less;
            }
            (Some(l), Some(r)) => match compare_segment(l, r) {
                Ordering::Equal => continue,
                other => return other,
            },
        }
    }
}

fn segment_is_zero(segment: &str) -> bool {
    let (num, rest) = split_segment(segment);
    num == 0 && rest.is_empty()
}

fn compare_segment(l: &str, r: &str) -> Ordering {
    let (ln, lrest) = split_segment(l);
    let (rn, rrest) = split_segment(r);
    match ln.cmp(&rn) {
        Ordering::Equal => lrest.cmp(rrest),
        other => other,
    }
}

fn split_segment(segment: &str) -> (u64, &str) {
    let digits: String = segment.chars().take_while(|c| c.is_ascii_digit()).collect();
    let rest = &segment[digits.len()..];
    let number = if digits.is_empty() { 0 } else { digits.parse().unwrap_or(u64::MAX) };
    (number, rest)
}

pub fn pick_exe(candidates: &[ExeCandidate], base_name: &str) -> Option<String> {
    let usable: Vec<&ExeCandidate> = candidates
        .iter()
        .filter(|c| !is_helper_exe(&c.path))
        .collect();
    if usable.is_empty() {
        return None;
    }

    let mut depths: Vec<u8> = usable.iter().map(|c| c.depth).collect();
    depths.sort_unstable();
    depths.dedup();

    for depth in depths {
        let level: Vec<&&ExeCandidate> = usable.iter().filter(|c| c.depth == depth).collect();
        if level.is_empty() {
            continue;
        }
        if let Some(hit) = level
            .iter()
            .find(|c| normalize_base(file_stem(&c.path)) == base_name)
        {
            return Some(hit.path.clone());
        }
        if level.len() == 1 {
            return Some(level[0].path.clone());
        }
        if let Some(hit) = level
            .iter()
            .find(|c| base_name.starts_with(&normalize_base(file_stem(&c.path))) && !file_stem(&c.path).is_empty())
        {
            return Some(hit.path.clone());
        }
        let biggest = level.iter().max_by_key(|c| c.size)?;
        return Some(biggest.path.clone());
    }
    None
}

fn file_stem(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.rfind('.') {
        Some(dot) => &name[..dot],
        None => name,
    }
}

fn is_helper_exe(path: &str) -> bool {
    let stem = file_stem(path).to_lowercase();
    if EXE_SKIP_ANYWHERE.iter().any(|part| stem.contains(part)) {
        return true;
    }
    EXE_SKIP_PARTS.iter().any(|part| {
        if stem == *part {
            return true;
        }
        let Some(tail) = stem.strip_prefix(part) else {
            return false;
        };
        !tail.starts_with(|c: char| c.is_alphabetic())
    })
}

pub fn version_in_brackets(title: &str) -> Option<String> {
    let mut rest = title;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let close = after.find(']')?;
        let inner = after[..close].trim();
        if is_version_token(inner) {
            return Some(strip_version_prefix(inner).to_string());
        }
        rest = &after[close + 1..];
    }
    None
}

pub fn f95_version_from_html(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    for selector in ["title", "h1.p-title-value"] {
        let Ok(sel) = Selector::parse(selector) else {
            continue;
        };
        if let Some(text) = document.select(&sel).next() {
            let joined = text.text().collect::<String>();
            if let Some(version) = version_in_brackets(&joined) {
                return Some(version);
            }
        }
    }
    None
}

pub fn f95_cover_from_html(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let post = Selector::parse("article img.bbImage, .message-body img.bbImage, img.bbImage").ok()?;
    for img in document.select(&post) {
        let value = img
            .value()
            .attr("data-src")
            .or_else(|| img.value().attr("data-url"))
            .or_else(|| img.value().attr("src"))
            .map(str::trim)
            .filter(|v| !v.is_empty())?;
        if value.starts_with("data:") {
            continue;
        }
        return Some(full_size_attachment(value));
    }
    None
}

pub fn full_size_attachment(url: &str) -> String {
    match url.rfind("/thumb/") {
        Some(at) => format!("{}/{}", &url[..at], &url[at + "/thumb/".len()..]),
        None => url.to_string(),
    }
}

pub fn itch_updated_from_html(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let row = Selector::parse("tr").ok()?;
    let cell = Selector::parse("td").ok()?;
    let abbr = Selector::parse("abbr").ok()?;
    for tr in document.select(&row) {
        let mut cells = tr.select(&cell);
        let Some(first) = cells.next() else {
            continue;
        };
        if first.text().collect::<String>().trim() != "Updated" {
            continue;
        }
        if let Some(stamp) = tr.select(&abbr).next().and_then(|a| a.value().attr("title")) {
            return parse_itch_stamp(stamp);
        }
    }
    None
}

pub fn itch_updated_from_devlog(rss: &str) -> Option<String> {
    let items = rss.find("<item>").or_else(|| rss.find("<item "))?;
    let tail = &rss[items..];
    let open = tail.find("<pubDate>")? + "<pubDate>".len();
    let close = tail[open..].find("</pubDate>")? + open;
    parse_rfc822_stamp(tail[open..close].trim())
}

pub fn parse_itch_stamp(stamp: &str) -> Option<String> {
    let cleaned = stamp.replace('@', " ");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let day: u32 = parts[0].parse().ok()?;
    let month = month_number(parts[1])?;
    let year: i32 = parts[2].parse().ok()?;
    format_stamp(year, month, day, clock_of(&parts[3..]))
}

pub fn parse_rfc822_stamp(stamp: &str) -> Option<String> {
    let parts: Vec<&str> = stamp.split_whitespace().collect();
    let offset = usize::from(!parts.first()?.starts_with(|c: char| c.is_ascii_digit()));
    let day: u32 = parts.get(offset)?.parse().ok()?;
    let month = month_number(parts.get(offset + 1)?)?;
    let year: i32 = parts.get(offset + 2)?.parse().ok()?;
    format_stamp(year, month, day, clock_of(&parts[(offset + 3).min(parts.len())..]))
}

fn clock_of<'a>(rest: &[&'a str]) -> Option<&'a str> {
    rest.iter().copied().find(|part| part.contains(':'))
}

fn format_stamp(year: i32, month: u32, day: u32, time: Option<&str>) -> Option<String> {
    if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
        return None;
    }
    let mut clock = time.unwrap_or("00:00").split(':');
    let hour: u32 = clock.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let minute: u32 = clock.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    if hour > 23 || minute > 59 {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}Z"))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn month_number(raw: &str) -> Option<u32> {
    let lower = raw.to_lowercase();
    if lower.len() < 3 {
        return None;
    }
    MONTHS
        .iter()
        .find(|(name, _)| lower.starts_with(name))
        .map(|(_, number)| *number)
}

pub fn source_from_url(raw: &str) -> Option<Source> {
    let parsed = url::Url::parse(raw.trim()).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    if host == "f95zone.to" || host.ends_with(".f95zone.to") {
        return Some(Source::F95);
    }
    if host == "itch.io" || host.ends_with(".itch.io") {
        return Some(Source::Itch);
    }
    None
}

pub fn f95_thread_id(raw: &str) -> Option<String> {
    let parsed = url::Url::parse(raw.trim()).ok()?;
    let mut segments = parsed.path_segments()?;
    segments.find(|s| *s == "threads")?;
    let slug = segments.next()?;
    let tail = slug.rsplit('.').next()?;
    if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
        Some(tail.to_string())
    } else {
        None
    }
}

pub fn has_update(
    source: Source,
    installed: Option<&str>,
    site: Option<&str>,
    seen: Option<&str>,
    skipped: Option<&str>,
) -> bool {
    let Some(site) = site.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    if skipped
        .map(|s| s.trim().to_lowercase())
        .is_some_and(|s| s == site.to_lowercase())
    {
        return false;
    }
    match source {
        Source::F95 => {
            if !looks_like_version(site) {
                return false;
            }
            let Some(installed) = installed.map(str::trim).filter(|s| !s.is_empty()) else {
                return true;
            };
            if !looks_like_version(installed) {
                return site != installed;
            }
            compare_versions(site, installed) == Ordering::Greater
        }
        Source::Itch => {
            let Some(seen) = seen.map(str::trim).filter(|s| !s.is_empty()) else {
                return false;
            };
            site > seen
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: i64,
    pub base_name: String,
    pub title: String,
    pub folder_path: Option<String>,
    pub folder_name: Option<String>,
    pub version_installed: Option<String>,
    pub version_source: String,
    pub source: Option<String>,
    pub page_url: Option<String>,
    pub image: Option<String>,
    pub image_x: f64,
    pub image_y: f64,
    pub status: String,
    pub rating: i64,
    pub exe_path: Option<String>,
    pub exe_source: String,
    pub size_bytes: Option<i64>,
    pub last_launched_at: Option<i64>,
    pub site_version: Option<String>,
    pub seen_version: Option<String>,
    pub skipped_version: Option<String>,
    pub last_checked_at: Option<i64>,
    pub tags: Vec<String>,
    pub has_update: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScannedFolder {
    pub name: String,
    pub path: String,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub added: usize,
    pub relinked: usize,
    pub detached: usize,
}

pub const STATUSES: &[&str] = &["new", "playing", "finished", "dropped"];

pub fn source_str(source: Source) -> &'static str {
    match source {
        Source::F95 => "f95",
        Source::Itch => "itch",
    }
}

pub fn source_from_str(raw: &str) -> Option<Source> {
    match raw {
        "f95" => Some(Source::F95),
        "itch" => Some(Source::Itch),
        _ => None,
    }
}

pub fn status_or_default(raw: &str) -> &str {
    if STATUSES.contains(&raw) {
        raw
    } else {
        "new"
    }
}

fn row_to_game(row: &rusqlite::Row) -> rusqlite::Result<Game> {
    let source: Option<String> = row.get("source")?;
    let site_version: Option<String> = row.get("site_version")?;
    let seen_version: Option<String> = row.get("seen_version")?;
    let skipped_version: Option<String> = row.get("skipped_version")?;
    let version_installed: Option<String> = row.get("version_installed")?;
    let update_waiting = source
        .as_deref()
        .and_then(source_from_str)
        .is_some_and(|src| {
            has_update(
                src,
                version_installed.as_deref(),
                site_version.as_deref(),
                seen_version.as_deref(),
                skipped_version.as_deref(),
            )
        });
    Ok(Game {
        id: row.get("id")?,
        base_name: row.get("base_name")?,
        title: row.get("title")?,
        folder_path: row.get("folder_path")?,
        folder_name: row.get("folder_name")?,
        version_installed,
        version_source: row.get("version_source")?,
        source,
        page_url: row.get("page_url")?,
        image: row.get("image")?,
        image_x: row.get("image_x")?,
        image_y: row.get("image_y")?,
        status: row.get("status")?,
        rating: row.get("rating")?,
        exe_path: row.get("exe_path")?,
        exe_source: row.get("exe_source")?,
        size_bytes: row.get("size_bytes")?,
        last_launched_at: row.get("last_launched_at")?,
        site_version,
        seen_version,
        skipped_version,
        last_checked_at: row.get("last_checked_at")?,
        tags: Vec::new(),
        has_update: update_waiting,
    })
}

pub fn tags_of(conn: &Connection, id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t JOIN game_tags gt ON gt.tag_id = t.id \
         WHERE gt.game_id = ?1 ORDER BY t.name COLLATE NOCASE",
    )?;
    let names = stmt.query_map(params![id], |row| row.get(0))?.collect();
    names
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Game>> {
    let mut stmt = conn.prepare("SELECT * FROM games ORDER BY title COLLATE NOCASE")?;
    let mut games: Vec<Game> = stmt
        .query_map([], row_to_game)?
        .collect::<rusqlite::Result<_>>()?;
    for game in &mut games {
        game.tags = tags_of(conn, game.id)?;
    }
    Ok(games)
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Game>> {
    let mut stmt = conn.prepare("SELECT * FROM games WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], row_to_game)?;
    let Some(game) = rows.next().transpose()? else {
        return Ok(None);
    };
    let mut game = game;
    game.tags = tags_of(conn, id)?;
    Ok(Some(game))
}

pub fn set_tags(conn: &mut Connection, id: i64, names: &[String]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM game_tags WHERE game_id = ?1", params![id])?;
    for name in names {
        let Some(tag_id) = crate::tags::upsert(&tx, name)? else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?1, ?2)",
            params![id, tag_id],
        )?;
    }
    tx.commit()
}

fn base_taken(conn: &Connection, base: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM games WHERE base_name = ?1)",
        params![base],
        |row| row.get(0),
    )
}

pub fn unique_base(conn: &Connection, base: &str) -> rusqlite::Result<String> {
    if !base_taken(conn, base)? {
        return Ok(base.to_string());
    }
    let mut suffix = 2u32;
    loop {
        let candidate = format!("{base}#{suffix}");
        if !base_taken(conn, &candidate)? {
            return Ok(candidate);
        }
        suffix += 1;
    }
}

pub fn sync(conn: &mut Connection, folders: &[ScannedFolder]) -> rusqlite::Result<SyncReport> {
    let tx = conn.transaction()?;
    let mut report = SyncReport { added: 0, relinked: 0, detached: 0 };

    let attached: Vec<(i64, String)> = {
        let mut stmt = tx.prepare("SELECT id, folder_path FROM games WHERE folder_path IS NOT NULL")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        rows
    };
    for (id, path) in attached {
        if !folders.iter().any(|f| f.path == path) {
            tx.execute(
                "UPDATE games SET folder_path = NULL, updated_at = unixepoch() WHERE id = ?1",
                params![id],
            )?;
            report.detached += 1;
        }
    }

    for folder in folders {
        let parsed = parse_folder_name(&folder.name);

        let by_path: Option<i64> = tx
            .query_row(
                "SELECT id FROM games WHERE folder_path = ?1",
                params![folder.path],
                |row| row.get(0),
            )
            .optional()?;

        let target = match by_path {
            Some(id) => Some(id),
            None => tx
                .query_row(
                    "SELECT id FROM games WHERE base_name = ?1 AND folder_path IS NULL",
                    params![parsed.base_name],
                    |row| row.get(0),
                )
                .optional()?,
        };

        match target {
            Some(id) => {
                tx.execute(
                    "UPDATE games SET folder_path = ?1, folder_name = ?2, \
                     size_bytes = COALESCE(?3, size_bytes), \
                     version_installed = CASE WHEN version_source = 'folder' AND ?4 IS NOT NULL \
                         THEN ?4 ELSE version_installed END, \
                     title = CASE WHEN title_source = 'folder' THEN ?5 ELSE title END, \
                     updated_at = unixepoch() WHERE id = ?6",
                    params![
                        folder.path,
                        folder.name,
                        folder.size_bytes,
                        parsed.version,
                        parsed.title,
                        id
                    ],
                )?;
                if by_path.is_none() {
                    report.relinked += 1;
                }
            }
            None => {
                let base = unique_base(&tx, &parsed.base_name)?;
                tx.execute(
                    "INSERT INTO games (base_name, title, folder_path, folder_name, \
                     version_installed, size_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        base,
                        parsed.title,
                        folder.path,
                        folder.name,
                        parsed.version,
                        folder.size_bytes
                    ],
                )?;
                report.added += 1;
            }
        }
    }

    tx.commit()?;
    Ok(report)
}

pub fn set_title(conn: &Connection, id: i64, title: &str) -> rusqlite::Result<()> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    conn.execute(
        "UPDATE games SET title = ?1, title_source = 'manual', updated_at = unixepoch() WHERE id = ?2",
        params![trimmed, id],
    )?;
    Ok(())
}

pub fn set_version(conn: &Connection, id: i64, version: Option<&str>) -> rusqlite::Result<()> {
    let cleaned = version.map(str::trim).filter(|v| !v.is_empty());
    conn.execute(
        "UPDATE games SET version_installed = ?1, version_source = 'manual', \
         updated_at = unixepoch() WHERE id = ?2",
        params![cleaned, id],
    )?;
    Ok(())
}

pub fn set_status(conn: &Connection, id: i64, status: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET status = ?1, updated_at = unixepoch() WHERE id = ?2",
        params![status_or_default(status), id],
    )?;
    Ok(())
}

pub fn set_rating(conn: &Connection, id: i64, rating: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET rating = ?1, updated_at = unixepoch() WHERE id = ?2",
        params![rating.clamp(0, 5), id],
    )?;
    Ok(())
}

pub fn set_size(conn: &Connection, id: i64, size: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE games SET size_bytes = ?1 WHERE id = ?2", params![size, id])?;
    Ok(())
}

pub fn set_page(conn: &Connection, id: i64, url: Option<&str>) -> rusqlite::Result<()> {
    let cleaned = url.map(str::trim).filter(|u| !u.is_empty());
    let source = cleaned.and_then(source_from_url).map(source_str);

    let current: Option<String> = conn
        .query_row("SELECT page_url FROM games WHERE id = ?1", params![id], |row| row.get(0))
        .optional()?
        .flatten();
    if current.as_deref() == cleaned {
        return Ok(());
    }

    conn.execute(
        "UPDATE games SET page_url = ?1, source = ?2, site_version = NULL, \
         seen_version = NULL, skipped_version = NULL, last_checked_at = NULL, \
         updated_at = unixepoch() WHERE id = ?3",
        params![cleaned, source, id],
    )?;
    Ok(())
}

pub fn set_image(conn: &Connection, id: i64, file: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET image = ?1, updated_at = unixepoch() WHERE id = ?2",
        params![file, id],
    )?;
    Ok(())
}

pub fn clamp_percent(value: f64) -> f64 {
    if value.is_nan() {
        return 50.0;
    }
    value.clamp(0.0, 100.0)
}

pub fn set_cover_pos(conn: &Connection, id: i64, x: f64, y: f64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET image_x = ?1, image_y = ?2, updated_at = unixepoch() WHERE id = ?3",
        params![clamp_percent(x), clamp_percent(y), id],
    )?;
    Ok(())
}

pub fn record_check(
    conn: &Connection,
    id: i64,
    site_version: Option<&str>,
    first_time: bool,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET site_version = ?1, last_checked_at = unixepoch(), \
         seen_version = CASE WHEN ?2 THEN ?1 ELSE seen_version END, \
         updated_at = unixepoch() WHERE id = ?3",
        params![site_version, first_time, id],
    )?;
    Ok(())
}

pub fn skip_current_version(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET skipped_version = site_version, updated_at = unixepoch() \
         WHERE id = ?1 AND site_version IS NOT NULL",
        params![id],
    )?;
    Ok(())
}

pub fn checkable(conn: &Connection) -> rusqlite::Result<Vec<(i64, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, source, page_url FROM games \
         WHERE page_url IS NOT NULL AND source IS NOT NULL ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect();
    rows
}

pub fn set_exe(conn: &Connection, id: i64, path: &str, manual: bool) -> rusqlite::Result<()> {
    let source = if manual { "manual" } else { "auto" };
    conn.execute(
        "UPDATE games SET exe_path = ?1, exe_source = ?2, updated_at = unixepoch() WHERE id = ?3",
        params![path, source, id],
    )?;
    Ok(())
}

pub fn games_without_manual_exe(conn: &Connection) -> rusqlite::Result<Vec<(i64, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, base_name, folder_path FROM games \
         WHERE folder_path IS NOT NULL AND exe_source != 'manual'",
    )?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect();
    rows
}

pub fn set_exe_auto(conn: &Connection, id: i64, path: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET exe_path = ?1, exe_source = 'auto', updated_at = unixepoch() \
         WHERE id = ?2 AND exe_source != 'manual'",
        params![path, id],
    )?;
    Ok(())
}

pub fn mark_launched(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET last_launched_at = unixepoch() WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn detach_folder(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE games SET folder_path = NULL, size_bytes = NULL, exe_path = NULL, \
         exe_source = 'auto', updated_at = unixepoch() WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn forget(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM games WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn
    }

    fn folder(name: &str) -> ScannedFolder {
        ScannedFolder {
            name: name.to_string(),
            path: format!("E:\\Games\\{name}"),
            size_bytes: Some(1024),
        }
    }

    #[test]
    fn parses_folder_with_version_and_platform_suffix() {
        let parsed = parse_folder_name("PathOfDesire-0.5.2-pc");
        assert_eq!(parsed.title, "Path Of Desire");
        assert_eq!(parsed.base_name, "pathofdesire");
        assert_eq!(parsed.version.as_deref(), Some("0.5.2"));
    }

    #[test]
    fn parses_version_with_letter_revision() {
        let parsed = parse_folder_name("AHouseInTheRift-0.8.12r1-pc");
        assert_eq!(parsed.title, "A House In The Rift");
        assert_eq!(parsed.base_name, "ahouseintherift");
        assert_eq!(parsed.version.as_deref(), Some("0.8.12r1"));
    }

    #[test]
    fn parses_folder_without_version() {
        let parsed = parse_folder_name("Summer_Memories");
        assert_eq!(parsed.title, "Summer Memories");
        assert_eq!(parsed.base_name, "summermemories");
        assert_eq!(parsed.version, None);
    }

    #[test]
    fn parses_cyrillic_folder() {
        let parsed = parse_folder_name("Тайна Особняка-1.2-pc");
        assert_eq!(parsed.title, "Тайна Особняка");
        assert_eq!(parsed.base_name, "тайнаособняка");
        assert_eq!(parsed.version.as_deref(), Some("1.2"));
    }

    #[test]
    fn folder_title_refreshes_unless_user_renamed() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();

        let folders = vec![ScannedFolder {
            path: "C:/games/Neighbor [ver 0.2.4]".into(),
            name: "Neighbor [ver 0.2.4]".into(),
            size_bytes: None,
        }];
        sync(&mut conn, &folders).unwrap();
        let first = list(&conn).unwrap().remove(0);
        assert_eq!(first.title, "Neighbor");
        assert_eq!(first.version_installed.as_deref(), Some("0.2.4"));

        set_title(&conn, first.id, "Мой сосед").unwrap();
        sync(&mut conn, &folders).unwrap();
        assert_eq!(list(&conn).unwrap().remove(0).title, "Мой сосед");
    }

    #[test]
    fn version_in_square_brackets_after_word() {
        let parsed = parse_folder_name("My neighbor is way too perverted! Remake [ver 0.2.4]");
        assert_eq!(parsed.version.as_deref(), Some("0.2.4"));
        assert_eq!(parsed.title, "My neighbor is way too perverted! Remake");

        let short = parse_folder_name("Harem Fantasy [v1.2]");
        assert_eq!(short.version.as_deref(), Some("1.2"));
        assert_eq!(short.title, "Harem Fantasy");

        let round = parse_folder_name("Lyndaria (version 0.9)");
        assert_eq!(round.version.as_deref(), Some("0.9"));
        assert_eq!(round.title, "Lyndaria");

        let plain = parse_folder_name("Vector Strike");
        assert_eq!(plain.version, None);
        assert_eq!(plain.title, "Vector Strike");
    }

    #[test]
    fn version_from_dotted_v() {
        let dotted = parse_folder_name("Unmasking Julia v.15.0");
        assert_eq!(dotted.title, "Unmasking Julia");
        assert_eq!(dotted.version.as_deref(), Some("15.0"));

        let rule34 = parse_folder_name("Rule34 v.1.2.4");
        assert_eq!(rule34.version.as_deref(), Some("1.2.4"));

        assert_eq!(
            parse_folder_name("PathOfDesire-0.5.2-pc").version.as_deref(),
            Some("0.5.2")
        );
        assert_eq!(parse_folder_name("Summer_Memories").version, None);

        assert_eq!(parse_folder_name("Vector Strike").version, None);
    }

    #[test]
    fn keeps_name_when_version_leads() {
        let parsed = parse_folder_name("7Days-pc");
        assert_eq!(parsed.base_name, "7days");
        assert_eq!(parsed.version, None);
    }

    #[test]
    fn renamed_folder_keeps_same_base_name() {
        let before = parse_folder_name("PathOfDesire-0.5.2-pc");
        let after = parse_folder_name("PathOfDesire-0.6.0-pc");
        assert_eq!(before.base_name, after.base_name);
        assert_ne!(before.version, after.version);
    }

    #[test]
    fn platform_word_alone_stays_in_name() {
        let parsed = parse_folder_name("Windows");
        assert_eq!(parsed.base_name, "windows");
    }

    #[test]
    fn version_in_the_middle_keeps_the_tail_of_the_name() {
        let parsed = parse_folder_name("Game-0.5-Extra-pc");
        assert_eq!(parsed.base_name, "gameextra");
        assert_eq!(parsed.version.as_deref(), Some("0.5"));
        assert_ne!(parse_folder_name("Game-0.6-Something-pc").base_name, parsed.base_name);
    }

    #[test]
    fn version_at_the_front_does_not_drift_base_name() {
        let old = parse_folder_name("v0.5-SomeGame-pc");
        let new = parse_folder_name("v0.6-SomeGame-pc");
        assert_eq!(old.base_name, "somegame");
        assert_eq!(old.base_name, new.base_name);
        assert_eq!(new.version.as_deref(), Some("0.6"));
    }

    #[test]
    fn symbol_only_names_stay_distinct() {
        assert_eq!(parse_folder_name("---").base_name, "---");
        assert_eq!(parse_folder_name("🎮🎮").base_name, "🎮🎮");
        assert_ne!(parse_folder_name("---").base_name, parse_folder_name("🎮🎮").base_name);
    }

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(compare_versions("0.10.0", "0.9.0"), Ordering::Greater);
        assert_eq!(compare_versions("0.5.2", "0.5.2"), Ordering::Equal);
        assert_eq!(compare_versions("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.8.12r1", "0.8.12"), Ordering::Greater);
        assert_eq!(compare_versions("0.5.2", "0.6.0"), Ordering::Less);
    }

    #[test]
    fn huge_version_number_does_not_wrap_to_zero() {
        assert_eq!(
            compare_versions("99999999999999999999.0", "1.0"),
            Ordering::Greater
        );
    }

    #[test]
    fn picks_game_exe_over_helpers() {
        let candidates = vec![
            ExeCandidate { path: "unins000.exe".into(), size: 3_000_000, depth: 0 },
            ExeCandidate { path: "vcredist_x64.exe".into(), size: 9_000_000, depth: 0 },
            ExeCandidate { path: "PathOfDesire.exe".into(), size: 1_000_000, depth: 0 },
        ];
        assert_eq!(pick_exe(&candidates, "pathofdesire").as_deref(), Some("PathOfDesire.exe"));
    }

    #[test]
    fn skips_engine_crash_handlers() {
        let candidates = vec![
            ExeCandidate { path: "UnityCrashHandler64.exe".into(), size: 2_000_000, depth: 0 },
            ExeCandidate { path: "CrashReportClient.exe".into(), size: 1_500_000, depth: 0 },
            ExeCandidate { path: "Maji.exe".into(), size: 900_000, depth: 0 },
        ];
        assert_eq!(pick_exe(&candidates, "majiiki").as_deref(), Some("Maji.exe"));

        let only_helpers = vec![ExeCandidate {
            path: "UnityCrashHandler64.exe".into(),
            size: 2_000_000,
            depth: 0,
        }];
        assert_eq!(pick_exe(&only_helpers, "whatever"), None);

        let real_game = vec![ExeCandidate { path: "Crash Bandicoot.exe".into(), size: 10_000, depth: 0 }];
        assert_eq!(pick_exe(&real_game, "crashbandicoot").as_deref(), Some("Crash Bandicoot.exe"));
    }

    #[test]
    fn picks_biggest_when_names_do_not_match() {
        let candidates = vec![
            ExeCandidate { path: "start.exe".into(), size: 1_000, depth: 0 },
            ExeCandidate { path: "game.exe".into(), size: 50_000, depth: 0 },
        ];
        assert_eq!(pick_exe(&candidates, "someother").as_deref(), Some("game.exe"));
    }

    #[test]
    fn falls_back_to_nested_exe() {
        let candidates = vec![
            ExeCandidate { path: "unins000.exe".into(), size: 3_000_000, depth: 0 },
            ExeCandidate { path: "game/Game.exe".into(), size: 10_000, depth: 1 },
        ];
        assert_eq!(pick_exe(&candidates, "game").as_deref(), Some("game/Game.exe"));
    }

    #[test]
    fn keeps_games_whose_name_starts_like_a_helper() {
        let candidates = vec![ExeCandidate {
            path: "PythonicDreams.exe".into(),
            size: 5_000,
            depth: 0,
        }];
        assert_eq!(
            pick_exe(&candidates, "pythonicdreams").as_deref(),
            Some("PythonicDreams.exe")
        );
        let installment = vec![ExeCandidate { path: "Installment.exe".into(), size: 5_000, depth: 0 }];
        assert_eq!(pick_exe(&installment, "installment").as_deref(), Some("Installment.exe"));
        let helper = vec![ExeCandidate { path: "python3.exe".into(), size: 5_000, depth: 0 }];
        assert_eq!(pick_exe(&helper, "whatever"), None);
    }

    #[test]
    fn reaches_exe_deeper_than_one_level() {
        let candidates = vec![ExeCandidate {
            path: "data/bin/Game.exe".into(),
            size: 5_000,
            depth: 2,
        }];
        assert_eq!(pick_exe(&candidates, "game").as_deref(), Some("data/bin/Game.exe"));
    }

    #[test]
    fn returns_none_when_only_helpers() {
        let candidates = vec![ExeCandidate {
            path: "unins000.exe".into(),
            size: 10,
            depth: 0,
        }];
        assert_eq!(pick_exe(&candidates, "game"), None);
    }

    #[test]
    fn reads_version_from_f95_title() {
        let html = "<html><head><title>RPGM - Dicky Lucky [v0.02b] [wowidol999] | F95zone</title></head><body></body></html>";
        assert_eq!(f95_version_from_html(html).as_deref(), Some("0.02b"));
    }

    #[test]
    fn reads_version_from_f95_heading_when_title_missing() {
        let html = "<html><body><h1 class=\"p-title-value\">Ren'Py Path Of Desire [v0.6.0] [dev]</h1></body></html>";
        assert_eq!(f95_version_from_html(html).as_deref(), Some("0.6.0"));
    }

    #[test]
    fn ignores_non_version_brackets() {
        assert_eq!(version_in_brackets("Game [RPGM] [wowidol999]"), None);
        assert_eq!(version_in_brackets("Game [Completed] [1.0]").as_deref(), Some("1.0"));
    }

    #[test]
    fn takes_post_image_from_f95_page() {
        let html = r#"<html><head><meta property="og:image" content="https://f95zone.to/logo.png"></head>
            <body><article class="message-body">
            <img src="https://attachments.f95zone.to/2026/01/5673880_1768990117552.png"
                 data-src="https://attachments.f95zone.to/2026/01/5673880_1768990117552.png"
                 data-url="" class="bbImage lazyloaded" alt="1768990117552.png">
            </article></body></html>"#;
        assert_eq!(
            f95_cover_from_html(html).as_deref(),
            Some("https://attachments.f95zone.to/2026/01/5673880_1768990117552.png")
        );
    }

    #[test]
    fn takes_full_size_image_not_thumbnail() {
        let html = r#"<html><body><article class="message-body">
            <img src="https://attachments.f95zone.to/2026/01/thumb/5673880_1768990117552.png" class="bbImage ">
            </article></body></html>"#;
        assert_eq!(
            f95_cover_from_html(html).as_deref(),
            Some("https://attachments.f95zone.to/2026/01/5673880_1768990117552.png")
        );
        assert_eq!(
            full_size_attachment("https://example.com/a/thumb/b.png"),
            "https://example.com/a/b.png"
        );
        assert_eq!(
            full_size_attachment("https://example.com/a/b.png"),
            "https://example.com/a/b.png"
        );
    }

    #[test]
    fn f95_page_without_post_image_gives_nothing() {
        let html = "<html><body><p>нет картинок</p></body></html>";
        assert_eq!(f95_cover_from_html(html), None);
    }

    #[test]
    fn reads_updated_stamp_from_itch_page() {
        let html = "<html><body><table><tr><td>Updated</td><td><abbr title=\"04 September 2026 @ 14:11 UTC\">4 days ago</abbr></td></tr></table></body></html>";
        assert_eq!(itch_updated_from_html(html).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn reads_updated_stamp_from_devlog() {
        let rss = "<rss><channel><item><pubDate>Thu, 04 Sep 2026 14:11:00 GMT</pubDate></item></channel></rss>";
        assert_eq!(itch_updated_from_devlog(rss).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn skips_table_rows_without_cells_before_updated() {
        let html = "<html><body><table><tr><th colspan=\"2\">More information</th></tr><tr><td>Published</td><td>x</td></tr><tr><td>Updated</td><td><abbr title=\"04 September 2026 @ 14:11 UTC\">4 days ago</abbr></td></tr></table></body></html>";
        assert_eq!(itch_updated_from_html(html).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn devlog_ignores_channel_level_pub_date() {
        let rss = "<rss><channel><pubDate>Mon, 01 Jan 2020 00:00:00 GMT</pubDate><item><pubDate>Thu, 04 Sep 2026 14:11:00 GMT</pubDate></item></channel></rss>";
        assert_eq!(itch_updated_from_devlog(rss).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn stamps_without_time_or_comma_still_parse() {
        assert_eq!(parse_itch_stamp("04 September 2026").as_deref(), Some("2026-09-04T00:00Z"));
        assert_eq!(parse_itch_stamp("04 September 2026 UTC").as_deref(), Some("2026-09-04T00:00Z"));
        assert_eq!(
            parse_rfc822_stamp("04 Sep 2026 14:11:00 GMT").as_deref(),
            Some("2026-09-04T14:11Z")
        );
    }

    #[test]
    fn impossible_dates_are_rejected() {
        assert_eq!(parse_itch_stamp("31 February 2026 @ 10:00 UTC"), None);
        assert_eq!(parse_itch_stamp("04 September 2026 @ 26:00 UTC"), None);
        assert_eq!(parse_itch_stamp("29 February 2024 @ 10:00 UTC").as_deref(), Some("2024-02-29T10:00Z"));
        assert_eq!(parse_itch_stamp("не дата"), None);
    }

    #[test]
    fn detects_source_from_url() {
        assert_eq!(source_from_url("https://f95zone.to/threads/313900/"), Some(Source::F95));
        assert_eq!(source_from_url("https://zanithone.itch.io/a-house-in-the-rift"), Some(Source::Itch));
        assert_eq!(source_from_url("https://example.com/game"), None);
        assert_eq!(source_from_url("не ссылка"), None);
    }

    #[test]
    fn reads_thread_id_from_slug_and_plain_url() {
        assert_eq!(
            f95_thread_id("https://f95zone.to/threads/dicky-lucky-v0-02b-wowidol999.313900/").as_deref(),
            Some("313900")
        );
        assert_eq!(
            f95_thread_id("https://f95zone.to/threads/313900/").as_deref(),
            Some("313900")
        );
        assert_eq!(f95_thread_id("https://f95zone.to/latest"), None);
    }

    #[test]
    fn update_shows_when_site_version_is_newer() {
        assert!(has_update(Source::F95, Some("0.5.2"), Some("0.6.0"), None, None));
        assert!(!has_update(Source::F95, Some("0.6.0"), Some("0.6.0"), None, None));
        assert!(!has_update(Source::F95, Some("0.6.0"), Some("0.5.2"), None, None));
    }

    #[test]
    fn skipped_version_hides_update_until_newer_one() {
        assert!(!has_update(Source::F95, Some("0.5.2"), Some("0.6.0"), None, Some("0.6.0")));
        assert!(has_update(Source::F95, Some("0.5.2"), Some("0.7.0"), None, Some("0.6.0")));
    }

    #[test]
    fn unknown_installed_version_counts_as_update() {
        assert!(has_update(Source::F95, None, Some("0.6.0"), None, None));
        assert!(!has_update(Source::F95, None, None, None, None));
    }

    #[test]
    fn garbage_site_version_does_not_raise_a_badge() {
        assert!(!has_update(Source::F95, Some("0.5.2"), Some("Unknown"), None, None));
        assert!(!has_update(Source::F95, None, Some("Unknown"), None, None));
    }

    #[test]
    fn skipped_version_matches_regardless_of_case() {
        assert!(!has_update(
            Source::F95,
            Some("0.8.12"),
            Some("0.8.12r1"),
            None,
            Some("0.8.12R1")
        ));
    }

    #[test]
    fn sync_adds_new_folders_with_name_and_version() {
        let mut conn = db();
        let report = sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        assert_eq!(report.added, 1);

        let games = list(&conn).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].title, "Path Of Desire");
        assert_eq!(games[0].version_installed.as_deref(), Some("0.5.2"));
        assert_eq!(games[0].status, "new");
        assert_eq!(games[0].rating, 0);
        assert!(games[0].folder_path.is_some());
    }

    #[test]
    fn sync_is_idempotent() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        let second = sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        assert_eq!(second.added, 0);
        assert_eq!(second.detached, 0);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn renamed_folder_keeps_the_card_with_rating_and_tags() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_rating(&conn, id, 4).unwrap();
        set_status(&conn, id, "playing").unwrap();
        set_tags(&mut conn, id, &["фэнтези".to_string()]).unwrap();

        let report = sync(&mut conn, &[folder("PathOfDesire-0.6.0-pc")]).unwrap();
        assert_eq!(report.added, 0);
        assert_eq!(report.detached, 1);
        assert_eq!(report.relinked, 1);

        let games = list(&conn).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].id, id);
        assert_eq!(games[0].version_installed.as_deref(), Some("0.6.0"));
        assert_eq!(games[0].rating, 4);
        assert_eq!(games[0].status, "playing");
        assert_eq!(games[0].tags, vec!["фэнтези".to_string()]);
    }

    #[test]
    fn missing_folder_detaches_card_but_keeps_data() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_rating(&conn, id, 5).unwrap();

        let report = sync(&mut conn, &[]).unwrap();
        assert_eq!(report.detached, 1);

        let games = list(&conn).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].folder_path, None);
        assert_eq!(games[0].folder_name.as_deref(), Some("PathOfDesire-0.5.2-pc"));
        assert_eq!(games[0].rating, 5);

        let back = sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        assert_eq!(back.added, 0);
        assert_eq!(back.relinked, 1);
        assert!(list(&conn).unwrap()[0].folder_path.is_some());
    }

    #[test]
    fn two_folders_sharing_a_key_do_not_collide() {
        let mut conn = db();
        let report = sync(
            &mut conn,
            &[folder("Game-1.0-pc"), folder("Game-1.0-win")],
        )
        .unwrap();
        assert_eq!(report.added, 2);
        let games = list(&conn).unwrap();
        assert_eq!(games.len(), 2);
        assert_ne!(games[0].base_name, games[1].base_name);
    }

    #[test]
    fn manual_version_survives_folder_rename() {
        let mut conn = db();
        sync(&mut conn, &[folder("SummerMemories")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_version(&conn, id, Some("1.4")).unwrap();

        sync(&mut conn, &[folder("SummerMemories-2.0-pc")]).unwrap();
        let games = list(&conn).unwrap();
        assert_eq!(games[0].version_installed.as_deref(), Some("1.4"));
        assert_eq!(games[0].version_source, "manual");
    }

    #[test]
    fn rating_stays_inside_zero_to_five() {
        let mut conn = db();
        sync(&mut conn, &[folder("SummerMemories")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_rating(&conn, id, 9).unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().rating, 5);
        set_rating(&conn, id, -3).unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().rating, 0);
    }

    #[test]
    fn unknown_status_falls_back_to_new() {
        let mut conn = db();
        sync(&mut conn, &[folder("SummerMemories")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_status(&conn, id, "чепуха").unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().status, "new");
    }

    #[test]
    fn binding_a_page_sets_the_source_and_clears_old_check() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        let id = list(&conn).unwrap()[0].id;

        set_page(&conn, id, Some("https://f95zone.to/threads/313900/")).unwrap();
        let game = get(&conn, id).unwrap().unwrap();
        assert_eq!(game.source.as_deref(), Some("f95"));
        assert_eq!(game.site_version, None);
        assert!(!game.has_update);

        set_page(&conn, id, Some("https://example.com/game")).unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().source, None);

        set_page(&conn, id, None).unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().page_url, None);
    }

    #[test]
    fn first_check_after_binding_does_not_raise_a_badge() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_page(&conn, id, Some("https://f95zone.to/threads/313900/")).unwrap();

        record_check(&conn, id, Some("0.5.2"), true).unwrap();
        assert!(!get(&conn, id).unwrap().unwrap().has_update);

        record_check(&conn, id, Some("0.6.0"), false).unwrap();
        let game = get(&conn, id).unwrap().unwrap();
        assert!(game.has_update);
        assert_eq!(game.site_version.as_deref(), Some("0.6.0"));
    }

    #[test]
    fn rebinding_the_same_link_keeps_the_skipped_version() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        let link = "https://f95zone.to/threads/313900/";

        set_page(&conn, id, Some(link)).unwrap();
        record_check(&conn, id, Some("0.6.0"), false).unwrap();
        skip_current_version(&conn, id).unwrap();

        set_page(&conn, id, Some(link)).unwrap();
        let game = get(&conn, id).unwrap().unwrap();
        assert_eq!(game.skipped_version.as_deref(), Some("0.6.0"));
        assert!(!game.has_update);

        set_page(&conn, id, Some("https://f95zone.to/threads/999999/")).unwrap();
        assert_eq!(get(&conn, id).unwrap().unwrap().skipped_version, None);
    }

    #[test]
    fn only_the_first_check_records_what_was_seen() {
        let mut conn = db();
        sync(&mut conn, &[folder("SummerMemories")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_page(&conn, id, Some("https://zanithone.itch.io/a-house-in-the-rift")).unwrap();

        record_check(&conn, id, Some("2026-08-01T10:00Z"), true).unwrap();
        assert_eq!(
            get(&conn, id).unwrap().unwrap().seen_version.as_deref(),
            Some("2026-08-01T10:00Z")
        );

        record_check(&conn, id, Some("2026-09-04T14:11Z"), false).unwrap();
        let game = get(&conn, id).unwrap().unwrap();
        assert_eq!(game.seen_version.as_deref(), Some("2026-08-01T10:00Z"));
        assert_eq!(game.site_version.as_deref(), Some("2026-09-04T14:11Z"));
        assert!(game.has_update);
    }

    #[test]
    fn skipping_hides_the_badge_until_something_newer() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_page(&conn, id, Some("https://f95zone.to/threads/313900/")).unwrap();
        record_check(&conn, id, Some("0.6.0"), false).unwrap();

        skip_current_version(&conn, id).unwrap();
        assert!(!get(&conn, id).unwrap().unwrap().has_update);

        record_check(&conn, id, Some("0.7.0"), false).unwrap();
        assert!(get(&conn, id).unwrap().unwrap().has_update);
    }

    #[test]
    fn only_games_with_a_known_site_are_checked() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc"), folder("SummerMemories")]).unwrap();
        let games = list(&conn).unwrap();
        set_page(&conn, games[0].id, Some("https://f95zone.to/threads/313900/")).unwrap();
        set_page(&conn, games[1].id, Some("https://example.com/game")).unwrap();

        let queue = checkable(&conn).unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].1, "f95");
    }

    #[test]
    fn forgetting_a_game_drops_its_tags() {
        let mut conn = db();
        sync(&mut conn, &[folder("SummerMemories")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        set_tags(&mut conn, id, &["визуальная новелла".to_string()]).unwrap();
        forget(&conn, id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM game_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn itch_update_compares_stamps() {
        assert!(has_update(
            Source::Itch,
            None,
            Some("2026-09-04T14:11Z"),
            Some("2026-08-01T10:00Z"),
            None
        ));
        assert!(!has_update(
            Source::Itch,
            None,
            Some("2026-09-04T14:11Z"),
            Some("2026-09-04T14:11Z"),
            None
        ));
        assert!(!has_update(
            Source::Itch,
            None,
            Some("2026-09-04T14:11Z"),
            Some("2026-08-01T10:00Z"),
            Some("2026-09-04T14:11Z")
        ));
    }

    #[test]
    fn exe_guess() {
        let mut conn = db();
        sync(&mut conn, &[folder("Game-1.0-pc"), folder("NoExe-1.0-pc")]).unwrap();
        let games = list(&conn).unwrap();
        let game_id = games.iter().find(|g| g.base_name == "game").unwrap().id;
        let noexe_id = games.iter().find(|g| g.base_name == "noexe").unwrap().id;

        let with_exe = vec![ExeCandidate { path: "Game.exe".into(), size: 1000, depth: 0 }];
        let without_exe: Vec<ExeCandidate> = Vec::new();

        for (id, base_name, _folder_path) in games_without_manual_exe(&conn).unwrap() {
            let candidates = if id == game_id { &with_exe } else { &without_exe };
            if let Some(path) = pick_exe(candidates, &base_name) {
                set_exe_auto(&conn, id, &path).unwrap();
            }
        }

        let games = list(&conn).unwrap();
        let game = games.iter().find(|g| g.id == game_id).unwrap();
        assert_eq!(game.exe_path.as_deref(), Some("Game.exe"));
        assert_eq!(game.exe_source, "auto");
        let noexe = games.iter().find(|g| g.id == noexe_id).unwrap();
        assert_eq!(noexe.exe_path, None);

        set_exe(&conn, game_id, "Manual.exe", true).unwrap();

        let targets = games_without_manual_exe(&conn).unwrap();
        assert!(targets.iter().all(|(id, _, _)| *id != game_id));
        for (id, base_name, _folder_path) in targets {
            if let Some(path) = pick_exe(&with_exe, &base_name) {
                set_exe_auto(&conn, id, &path).unwrap();
            }
        }

        let game = list(&conn).unwrap().into_iter().find(|g| g.id == game_id).unwrap();
        assert_eq!(game.exe_path.as_deref(), Some("Manual.exe"));
        assert_eq!(game.exe_source, "manual");
    }

    #[test]
    fn clamp_percent_keeps_values_in_range() {
        assert_eq!(clamp_percent(0.0), 0.0);
        assert_eq!(clamp_percent(100.0), 100.0);
        assert_eq!(clamp_percent(-20.0), 0.0);
        assert_eq!(clamp_percent(380.0), 100.0);
        assert_eq!(clamp_percent(37.5), 37.5);
        assert_eq!(clamp_percent(f64::NAN), 50.0);
    }

    #[test]
    fn cover_pos_defaults_to_center_and_survives_update() {
        let mut conn = db();
        sync(&mut conn, &[folder("SummerMemories")]).unwrap();
        let id = list(&conn).unwrap()[0].id;
        let game = get(&conn, id).unwrap().unwrap();
        assert_eq!(game.image_x, 50.0);
        assert_eq!(game.image_y, 50.0);

        set_cover_pos(&conn, id, -20.0, 380.0).unwrap();
        let game = get(&conn, id).unwrap().unwrap();
        assert_eq!(game.image_x, 0.0);
        assert_eq!(game.image_y, 100.0);
    }
}
