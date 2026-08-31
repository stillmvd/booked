use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::bookmarks::Bookmark;
use crate::favicons;
use crate::folders::Folder;
use crate::tags;

pub type SearchHit = Bookmark;

pub const HIGHLIGHT_OPEN: &str = "\u{0002}";
pub const HIGHLIGHT_CLOSE: &str = "\u{0003}";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub title: String,
    pub host: String,
    pub snippet: String,
    pub description: String,
    pub matched_tags: Vec<String>,
    pub matched_in_url: bool,
    pub folder_path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMatch {
    pub name_highlighted: String,
    pub path: Vec<String>,
}

struct HighlightRaw {
    title_hl: String,
    host_hl: String,
    url_hl: String,
    desc_snip: String,
    desc_hl: String,
}

fn contains_marker(s: &str) -> bool {
    s.contains(HIGHLIGHT_OPEN)
}

fn fts_tokens(input: &str) -> Vec<&str> {
    input.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()).collect()
}

fn matched_tags_for(tags: &[String], query: &str) -> Vec<String> {
    let query_tokens: Vec<String> = fts_tokens(query).iter().map(|t| tags::normalize(t)).collect();
    if query_tokens.is_empty() {
        return Vec::new();
    }
    let last_idx = query_tokens.len() - 1;
    let mut out = Vec::new();
    for tag in tags {
        let normalized_tag = tags::normalize(tag);
        let tag_tokens = fts_tokens(&normalized_tag);
        let matched = tag_tokens.iter().any(|tag_token| {
            query_tokens.iter().enumerate().any(|(i, query_token)| {
                if i == last_idx {
                    tag_token.starts_with(query_token.as_str())
                } else {
                    *tag_token == query_token.as_str()
                }
            })
        });
        if matched && !out.iter().any(|n: &String| n == tag) {
            out.push(tag.clone());
        }
    }
    out
}

fn build_highlight(title: &str, host: &str, raw: Option<&HighlightRaw>) -> Highlight {
    match raw {
        None => Highlight {
            title: title.to_string(),
            host: host.to_string(),
            snippet: String::new(),
            description: String::new(),
            matched_tags: Vec::new(),
            matched_in_url: false,
            folder_path: Vec::new(),
        },
        Some(r) => {
            let title_marked = contains_marker(&r.title_hl);
            let host_marked = contains_marker(&r.host_hl);
            let url_marked = contains_marker(&r.url_hl);
            Highlight {
                title: r.title_hl.clone(),
                host: r.host_hl.clone(),
                snippet: r.desc_snip.clone(),
                description: r.desc_hl.clone(),
                matched_tags: Vec::new(),
                matched_in_url: url_marked && !title_marked && !host_marked,
                folder_path: Vec::new(),
            }
        }
    }
}

fn parse_path_ids(path: &str) -> Vec<i64> {
    path.split('/').filter(|s| !s.is_empty()).filter_map(|s| s.parse().ok()).collect()
}

fn ancestor_ids(path: &str) -> Vec<i64> {
    let ids = parse_path_ids(path);
    if ids.is_empty() {
        return ids;
    }
    ids[..ids.len() - 1].to_vec()
}

fn batch_folder_names(conn: &Connection, ids: &[i64]) -> rusqlite::Result<HashMap<i64, String>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!("SELECT id, name FROM folders WHERE id IN ({})", placeholders.join(","));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (id, name) = row?;
        map.insert(id, name);
    }
    Ok(map)
}

fn folder_path_names(conn: &Connection, raw_paths: &[Option<String>]) -> rusqlite::Result<Vec<Vec<String>>> {
    let all_ids: HashSet<i64> = raw_paths.iter().flatten().flat_map(|p| parse_path_ids(p)).collect();
    let names = batch_folder_names(conn, &all_ids.into_iter().collect::<Vec<_>>())?;
    Ok(raw_paths
        .iter()
        .map(|maybe_path| match maybe_path {
            None => Vec::new(),
            Some(path) => parse_path_ids(path).iter().filter_map(|id| names.get(id).cloned()).collect(),
        })
        .collect())
}

fn folder_matches(conn: &Connection, folders: &[Folder], text_query: Option<&str>) -> rusqlite::Result<Vec<FolderMatch>> {
    if folders.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<i64> = folders.iter().map(|f| f.id).collect();
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();

    let path_sql = format!("SELECT id, path FROM folders WHERE id IN ({})", placeholders.join(","));
    let mut path_stmt = conn.prepare(&path_sql)?;
    let path_by_id: HashMap<i64, String> = path_stmt
        .query_map(params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .collect();

    let name_highlights: HashMap<i64, String> = match text_query {
        None => HashMap::new(),
        Some(query) => {
            let id_placeholders: Vec<String> = (2..=ids.len() + 1).map(|i| format!("?{i}")).collect();
            let hl_sql = format!(
                "SELECT rowid, highlight(folders_fts, 0, '{HIGHLIGHT_OPEN}', '{HIGHLIGHT_CLOSE}') \
                 FROM folders_fts WHERE folders_fts MATCH ?1 AND rowid IN ({})",
                id_placeholders.join(",")
            );
            let mut hl_stmt = conn.prepare(&hl_sql)?;
            let mut hl_params: Vec<Value> = vec![Value::from(query.to_string())];
            hl_params.extend(ids.iter().map(|id| Value::from(*id)));
            let hl_rows = hl_stmt
                .query_map(params_from_iter(hl_params.iter()), |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            hl_rows.into_iter().collect()
        }
    };

    let all_ancestor_ids: HashSet<i64> = folders
        .iter()
        .filter_map(|f| path_by_id.get(&f.id))
        .flat_map(|p| ancestor_ids(p))
        .collect();
    let names = batch_folder_names(conn, &all_ancestor_ids.into_iter().collect::<Vec<_>>())?;

    Ok(folders
        .iter()
        .map(|f| {
            let path = path_by_id
                .get(&f.id)
                .map(|p| ancestor_ids(p).iter().filter_map(|id| names.get(id).cloned()).collect())
                .unwrap_or_default();
            let name_highlighted = name_highlights.get(&f.id).cloned().unwrap_or_else(|| f.name.clone());
            FolderMatch { name_highlighted, path }
        })
        .collect())
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    tags.iter()
        .map(|t| tags::normalize(t))
        .filter(|t| !t.is_empty())
        .collect()
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchSort {
    Relevance,
    Date,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub text: String,
    pub tags: Vec<String>,
    pub scope_folder_id: Option<i64>,
    pub current_folder_id: Option<i64>,
    pub sort: SearchSort,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub bookmarks: Vec<SearchHit>,
    pub total: i64,
    pub total_global: i64,
    pub in_current_folder: i64,
    pub folders: Vec<Folder>,
    pub highlights: Vec<Highlight>,
    pub folder_matches: Vec<FolderMatch>,
}

pub fn sanitize_fts_query(input: &str) -> Option<String> {
    let tokens: Vec<&str> = fts_tokens(input);
    if tokens.is_empty() {
        return None;
    }
    let last = tokens.len() - 1;
    let parts: Vec<String> = tokens
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let escaped = t.replace('"', "\"\"");
            if i == last {
                format!("\"{escaped}\"*")
            } else {
                format!("\"{escaped}\"")
            }
        })
        .collect();
    Some(parts.join(" "))
}

pub fn scope_prefix(conn: &Connection, folder_id: Option<i64>) -> rusqlite::Result<Option<String>> {
    match folder_id {
        None => Ok(None),
        Some(id) => conn
            .query_row("SELECT path FROM folders WHERE id = ?1", params![id], |row| {
                row.get::<_, String>(0)
            })
            .optional(),
    }
}

fn host_of_url_str(url: &str) -> Option<String> {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_string()))
}

fn tags_for_ids(conn: &Connection, ids: &[i64]) -> rusqlite::Result<HashMap<i64, Vec<String>>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT bt.bookmark_id, t.name FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id \
         WHERE bt.bookmark_id IN ({}) ORDER BY bt.bookmark_id, t.name",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        let (id, name) = row?;
        map.entry(id).or_default().push(name);
    }
    Ok(map)
}

pub fn search_folders(conn: &Connection, req: &SearchRequest) -> rusqlite::Result<Vec<Folder>> {
    let text_query = sanitize_fts_query(&req.text);
    let normalized_tags = normalize_tags(&req.tags);
    if text_query.is_none() && normalized_tags.is_empty() {
        return Ok(Vec::new());
    }

    let scope = scope_prefix(conn, req.scope_folder_id)?;

    let from_sql = if text_query.is_some() {
        "FROM folders_fts JOIN folders f ON f.id = folders_fts.rowid"
    } else {
        "FROM folders f"
    };

    let mut where_sql = String::new();
    let mut filter_params: Vec<Value> = Vec::new();
    if let Some(query) = &text_query {
        where_sql.push_str("folders_fts MATCH ?");
        filter_params.push(Value::from(query.clone()));
    } else {
        where_sql.push_str("1 = 1");
    }
    if !normalized_tags.is_empty() {
        let placeholders: Vec<&str> = normalized_tags.iter().map(|_| "?").collect();
        where_sql.push_str(&format!(
            " AND f.id IN (SELECT ft.folder_id FROM folder_tags ft \
             JOIN tags t ON t.id = ft.tag_id WHERE t.name_normalized IN ({}))",
            placeholders.join(",")
        ));
        for name in &normalized_tags {
            filter_params.push(Value::from(name.clone()));
        }
    }
    if let Some(prefix) = &scope {
        where_sql.push_str(" AND f.path LIKE ?");
        filter_params.push(Value::from(format!("{prefix}%")));
    }

    let sql = format!(
        "SELECT f.id, f.parent_id, f.name, f.description, f.image, f.sort, \
         (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) + \
         (SELECT COUNT(*) FROM folders WHERE parent_id = f.id) AS count \
         {from_sql} WHERE {where_sql} ORDER BY f.sort, f.id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut folders = stmt
        .query_map(params_from_iter(filter_params.iter()), |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                image: row.get(4)?,
                sort: row.get(5)?,
                count: row.get(6)?,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let ids: Vec<i64> = folders.iter().map(|f| f.id).collect();
    if !ids.is_empty() {
        let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
        let tag_sql = format!(
            "SELECT ft.folder_id, t.name FROM folder_tags ft JOIN tags t ON t.id = ft.tag_id \
             WHERE ft.folder_id IN ({}) ORDER BY ft.folder_id, t.name",
            placeholders.join(",")
        );
        let mut tag_stmt = conn.prepare(&tag_sql)?;
        let rows = tag_stmt.query_map(params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map: HashMap<i64, Vec<String>> = HashMap::new();
        for row in rows {
            let (id, name) = row?;
            map.entry(id).or_default().push(name);
        }
        for folder in folders.iter_mut() {
            if let Some(names) = map.remove(&folder.id) {
                folder.tags = names;
            }
        }
    }

    Ok(folders)
}

pub fn search_bookmarks(conn: &Connection, req: &SearchRequest) -> rusqlite::Result<SearchResults> {
    let text_query = sanitize_fts_query(&req.text);
    let normalized_tags = normalize_tags(&req.tags);
    if text_query.is_none() && normalized_tags.is_empty() {
        return Ok(SearchResults {
            bookmarks: Vec::new(),
            total: 0,
            total_global: 0,
            in_current_folder: 0,
            folders: Vec::new(),
            highlights: Vec::new(),
            folder_matches: Vec::new(),
        });
    }

    let scope = scope_prefix(conn, req.scope_folder_id)?;
    let current_folder_scope = scope_prefix(conn, req.current_folder_id)?;

    let from_sql = if text_query.is_some() {
        "FROM bookmarks_fts JOIN bookmarks b ON b.id = bookmarks_fts.rowid LEFT JOIN folders f ON f.id = b.folder_id"
    } else {
        "FROM bookmarks b LEFT JOIN folders f ON f.id = b.folder_id"
    };

    let mut where_sql = String::new();
    let mut filter_params: Vec<Value> = Vec::new();
    if let Some(query) = &text_query {
        where_sql.push_str("bookmarks_fts MATCH ?");
        filter_params.push(Value::from(query.clone()));
    } else {
        where_sql.push_str("1 = 1");
    }
    if !normalized_tags.is_empty() {
        let placeholders: Vec<&str> = normalized_tags.iter().map(|_| "?").collect();
        where_sql.push_str(&format!(
            " AND b.id IN (SELECT bt.bookmark_id FROM bookmark_tags bt \
             JOIN tags t ON t.id = bt.tag_id WHERE t.name_normalized IN ({}))",
            placeholders.join(",")
        ));
        for name in &normalized_tags {
            filter_params.push(Value::from(name.clone()));
        }
    }

    let candidates_sql = format!("SELECT b.id, f.path {from_sql} WHERE {where_sql}");
    let mut candidates_stmt = conn.prepare(&candidates_sql)?;
    let candidates: Vec<(i64, Option<String>)> = candidates_stmt
        .query_map(params_from_iter(filter_params.iter()), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(candidates_stmt);

    let in_scope = |path: &Option<String>| match &scope {
        None => true,
        Some(prefix) => path.as_deref().is_some_and(|p| p.starts_with(prefix.as_str())),
    };
    let in_current_folder_scope = |path: &Option<String>| match &current_folder_scope {
        None => false,
        Some(prefix) => path.as_deref().is_some_and(|p| p.starts_with(prefix.as_str())),
    };

    let total_global = candidates.len() as i64;
    let total = candidates.iter().filter(|(_, path)| in_scope(path)).count() as i64;
    let in_current_folder = candidates
        .iter()
        .filter(|(_, path)| in_current_folder_scope(path))
        .count() as i64;

    let order_by = match &text_query {
        Some(_) => match req.sort {
            SearchSort::Relevance => "bm25(bookmarks_fts, 10.0, 4.0, 2.0, 3.0, 1.0) ASC",
            SearchSort::Date => "b.created_at DESC",
        },
        None => "b.sort ASC, b.id ASC",
    };

    let mut select_where = where_sql.clone();
    let mut select_params = filter_params.clone();
    if let Some(prefix) = &scope {
        select_where.push_str(" AND f.path LIKE ?");
        select_params.push(Value::from(format!("{prefix}%")));
    }
    select_params.push(Value::from(req.limit));
    select_params.push(Value::from(req.offset));

    let highlight_select = if text_query.is_some() {
        format!(
            ", highlight(bookmarks_fts, 0, '{HIGHLIGHT_OPEN}', '{HIGHLIGHT_CLOSE}') AS title_hl, \
               highlight(bookmarks_fts, 3, '{HIGHLIGHT_OPEN}', '{HIGHLIGHT_CLOSE}') AS host_hl, \
               highlight(bookmarks_fts, 4, '{HIGHLIGHT_OPEN}', '{HIGHLIGHT_CLOSE}') AS url_hl, \
               snippet(bookmarks_fts, 2, '{HIGHLIGHT_OPEN}', '{HIGHLIGHT_CLOSE}', '…', 12) AS desc_snip, \
               highlight(bookmarks_fts, 2, '{HIGHLIGHT_OPEN}', '{HIGHLIGHT_CLOSE}') AS desc_hl"
        )
    } else {
        String::new()
    };
    let has_highlight_cols = text_query.is_some();

    let select_sql = format!(
        "SELECT b.id, b.folder_id, b.title, b.url, b.url_normalized, b.description, b.image, \
         b.preview_file, b.preview_origin, b.preview_fetched_at, b.sort, b.created_at, \
         f.path AS folder_path_raw{highlight_select} \
         {from_sql} \
         WHERE {select_where} \
         ORDER BY {order_by} \
         LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&select_sql)?;
    let rows = stmt
        .query_map(params_from_iter(select_params.iter()), |row| {
            let bookmark = Bookmark {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                title: row.get(2)?,
                url: row.get(3)?,
                url_normalized: row.get(4)?,
                description: row.get(5)?,
                image: row.get(6)?,
                preview_file: row.get(7)?,
                preview_origin: row.get(8)?,
                preview_fetched_at: row.get(9)?,
                sort: row.get(10)?,
                created_at: row.get(11)?,
                tags: Vec::new(),
                favicon_file: None,
            };
            let folder_path_raw: Option<String> = row.get(12)?;
            let raw = if has_highlight_cols {
                Some(HighlightRaw {
                    title_hl: row.get(13)?,
                    host_hl: row.get(14)?,
                    url_hl: row.get(15)?,
                    desc_snip: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
                    desc_hl: row.get::<_, Option<String>>(17)?.unwrap_or_default(),
                })
            } else {
                None
            };
            Ok((bookmark, raw, folder_path_raw))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let mut bookmarks: Vec<Bookmark> = Vec::with_capacity(rows.len());
    let mut raws: Vec<Option<HighlightRaw>> = Vec::with_capacity(rows.len());
    let mut folder_path_raws: Vec<Option<String>> = Vec::with_capacity(rows.len());
    for (bookmark, raw, folder_path_raw) in rows {
        bookmarks.push(bookmark);
        raws.push(raw);
        folder_path_raws.push(folder_path_raw);
    }

    let ids: Vec<i64> = bookmarks.iter().map(|b| b.id).collect();
    let tags_map = tags_for_ids(conn, &ids)?;
    for bookmark in bookmarks.iter_mut() {
        if let Some(names) = tags_map.get(&bookmark.id) {
            bookmark.tags = names.clone();
        }
    }

    let hosts: Vec<String> = bookmarks
        .iter()
        .filter_map(|b| host_of_url_str(&b.url))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let favicon_map = favicons::for_hosts(conn, &hosts)?;
    for bookmark in bookmarks.iter_mut() {
        bookmark.favicon_file = host_of_url_str(&bookmark.url).and_then(|h| favicon_map.get(&h).cloned());
    }

    let folder_paths = folder_path_names(conn, &folder_path_raws)?;
    let highlights: Vec<Highlight> = bookmarks
        .iter()
        .zip(raws.iter())
        .zip(folder_paths.into_iter())
        .map(|((bookmark, raw), folder_path)| {
            let host = host_of_url_str(&bookmark.url).unwrap_or_default();
            let mut highlight = build_highlight(&bookmark.title, &host, raw.as_ref());
            highlight.folder_path = folder_path;
            highlight.matched_tags = text_query
                .as_deref()
                .map(|query| matched_tags_for(&bookmark.tags, query))
                .unwrap_or_default();
            highlight
        })
        .collect();

    let folders = search_folders(conn, req)?;
    let folder_matches = folder_matches(conn, &folders, text_query.as_deref())?;

    Ok(SearchResults {
        bookmarks,
        total,
        total_global,
        in_current_folder,
        folders,
        highlights,
        folder_matches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::{bookmarks, folders, url_norm};

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn create_bookmark(conn: &Connection, folder_id: Option<i64>, title: &str, url: &str) -> i64 {
        let parsed = url_norm::parse(url).unwrap();
        bookmarks::create(conn, folder_id, title, &parsed, None, None).unwrap()
    }

    fn default_request(text: &str) -> SearchRequest {
        SearchRequest {
            text: text.to_string(),
            tags: Vec::new(),
            scope_folder_id: None,
            current_folder_id: None,
            sort: SearchSort::Relevance,
            limit: 40,
            offset: 0,
        }
    }

    #[test]
    fn sanitize_wraps_tokens_and_stars_only_last() {
        let result = sanitize_fts_query("grid des").unwrap();
        assert_eq!(result, "\"grid\" \"des\"*");
    }

    #[test]
    fn sanitize_of_separators_only_returns_none() {
        assert_eq!(sanitize_fts_query("   ---   "), None);
        assert_eq!(sanitize_fts_query(""), None);
    }

    #[test]
    fn sanitize_survives_symbol_soup_and_operator_words_via_real_match() {
        let conn = setup();
        create_bookmark(&conn, None, "grid design", "https://example.test/grid");

        let inputs = [
            "\"кавычки\" -дефис *звёзд: ^каре (скобки)",
            "AND OR NOT NEAR",
            "grid AND design",
        ];
        for input in inputs {
            let query = sanitize_fts_query(input).unwrap();
            conn.query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH ?1",
                params![query],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        }
    }

    #[test]
    fn embedded_quote_cannot_close_a_phrase() {
        let conn = setup();
        create_bookmark(&conn, None, "quote test", "https://example.test/q");
        let query = sanitize_fts_query("a\"; DROP").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH ?1",
                params![query],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn operator_words_are_treated_as_plain_terms() {
        let conn = setup();
        create_bookmark(&conn, None, "AND OR NOT NEAR", "https://example.test/ops");
        let results = search_bookmarks(&conn, &default_request("AND")).unwrap();
        assert_eq!(results.bookmarks.len(), 1);
    }

    #[test]
    fn separators_only_input_skips_match_entirely() {
        let conn = setup();
        create_bookmark(&conn, None, "anything", "https://example.test/a");
        let results = search_bookmarks(&conn, &default_request("   ---   ")).unwrap();
        assert_eq!(results.bookmarks.len(), 0);
        assert_eq!(results.total, 0);
    }

    #[test]
    fn cyrillic_search_is_case_insensitive() {
        let conn = setup();
        create_bookmark(&conn, None, "Гриды в вёрстке", "https://example.test/grid");

        let upper = search_bookmarks(&conn, &default_request("ГРИД")).unwrap();
        assert_eq!(upper.bookmarks.len(), 1);

        let lower = search_bookmarks(&conn, &default_request("гриды")).unwrap();
        assert_eq!(lower.bookmarks.len(), 1);
    }

    #[test]
    fn title_match_ranks_above_url_only_match() {
        let conn = setup();
        let title_id = create_bookmark(&conn, None, "rustlang guide", "https://example.test/guide");
        let url_id = create_bookmark(&conn, None, "guide", "https://example.test/rustlang");

        let results = search_bookmarks(&conn, &default_request("rustlang")).unwrap();
        assert_eq!(results.bookmarks.len(), 2);
        assert_eq!(results.bookmarks[0].id, title_id);
        assert_eq!(results.bookmarks[1].id, url_id);
    }

    #[test]
    fn scope_none_includes_root_bookmarks() {
        let conn = setup();
        create_bookmark(&conn, None, "rootmatch item", "https://example.test/root");
        let results = search_bookmarks(&conn, &default_request("rootmatch")).unwrap();
        assert_eq!(results.bookmarks.len(), 1);
    }

    #[test]
    fn scope_by_folder_includes_descendants_excludes_outside() {
        let conn = setup();
        let parent = folders::create(&conn, "Parent", None).unwrap();
        let child = folders::create(&conn, "Child", Some(parent)).unwrap();
        let outside = folders::create(&conn, "Outside", None).unwrap();

        create_bookmark(&conn, Some(parent), "scopeword direct", "https://example.test/1");
        create_bookmark(&conn, Some(child), "scopeword nested", "https://example.test/2");
        create_bookmark(&conn, Some(outside), "scopeword elsewhere", "https://example.test/3");

        let mut req = default_request("scopeword");
        req.scope_folder_id = Some(parent);
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 2);
        assert!(results
            .bookmarks
            .iter()
            .all(|b| b.folder_id == Some(parent) || b.folder_id == Some(child)));
    }

    #[test]
    fn total_counts_all_matches_not_just_page() {
        let conn = setup();
        for i in 0..5 {
            create_bookmark(&conn, None, &format!("paged item {i}"), &format!("https://example.test/p{i}"));
        }
        let mut req = default_request("paged");
        req.limit = 2;
        req.offset = 0;
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 2);
        assert_eq!(results.total, 5);
    }

    #[test]
    fn search_hit_carries_favicon_by_raw_host() {
        let conn = setup();
        create_bookmark(&conn, None, "iconword bookmark", "https://has-icon.test/page");
        favicons::record(&conn, "has-icon.test", Some("abcd.png"), favicons::FaviconStatus::Found).unwrap();

        let results = search_bookmarks(&conn, &default_request("iconword")).unwrap();
        assert_eq!(results.bookmarks[0].favicon_file.as_deref(), Some("abcd.png"));
    }

    #[test]
    fn grandchild_bookmark_counts_in_current_folder() {
        let conn = setup();
        let parent = folders::create(&conn, "Родитель", None).unwrap();
        let child = folders::create(&conn, "Ребёнок", Some(parent)).unwrap();
        let grandchild = folders::create(&conn, "Внук", Some(child)).unwrap();
        let outside = folders::create(&conn, "Снаружи", None).unwrap();

        create_bookmark(&conn, Some(grandchild), "глубинасловоцель", "https://example.test/deep");
        create_bookmark(&conn, Some(outside), "глубинасловоцель снаружи", "https://example.test/out");

        let mut req = default_request("глубинасловоцель");
        req.current_folder_id = Some(parent);
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.total_global, 2);
        assert_eq!(results.in_current_folder, 1);
    }

    #[test]
    fn root_current_folder_gives_zero_in_current_folder() {
        let conn = setup();
        create_bookmark(&conn, None, "корневоесловоцель", "https://example.test/root2");

        let mut req = default_request("корневоесловоцель");
        req.current_folder_id = None;
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.in_current_folder, 0);
    }

    #[test]
    fn narrowed_scope_with_zero_matches_leaves_global_positive() {
        let conn = setup();
        let empty_folder = folders::create(&conn, "Пусто", None).unwrap();
        create_bookmark(&conn, None, "сужениесловоцель", "https://example.test/narrow");

        let mut req = default_request("сужениесловоцель");
        req.scope_folder_id = Some(empty_folder);
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.total, 0);
        assert!(results.total_global > 0);
    }

    #[test]
    fn root_bookmark_counts_global_not_folder() {
        let conn = setup();
        let folder = folders::create(&conn, "Папка", None).unwrap();
        create_bookmark(&conn, None, "корнесловоцель", "https://example.test/rootbm");

        let mut req = default_request("корнесловоцель");
        req.current_folder_id = Some(folder);
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.total_global, 1);
        assert_eq!(results.in_current_folder, 0);
    }

    fn tag_bookmark(conn: &Connection, bookmark_id: i64, names: &[&str]) {
        for name in names {
            let tag_id = tags::upsert(conn, name).unwrap().unwrap();
            conn.execute(
                "INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?1, ?2)",
                params![bookmark_id, tag_id],
            )
            .unwrap();
        }
    }

    #[test]
    fn one_selected_tag_returns_bookmarks_with_that_tag() {
        let conn = setup();
        let rust_bm = create_bookmark(&conn, None, "непересекающийсязаголовок1", "https://example.test/t1");
        tag_bookmark(&conn, rust_bm, &["rust"]);
        create_bookmark(&conn, None, "непересекающийсязаголовок2", "https://example.test/t2");

        let mut req = default_request("");
        req.tags = vec!["rust".to_string()];
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 1);
        assert_eq!(results.bookmarks[0].id, rust_bm);
    }

    #[test]
    fn two_selected_tags_union_and_widen_the_result() {
        let conn = setup();
        let rust_bm = create_bookmark(&conn, None, "тегобъединение1", "https://example.test/u1");
        tag_bookmark(&conn, rust_bm, &["rust"]);
        let sqlite_bm = create_bookmark(&conn, None, "тегобъединение2", "https://example.test/u2");
        tag_bookmark(&conn, sqlite_bm, &["sqlite"]);

        let mut only_rust = default_request("");
        only_rust.tags = vec!["rust".to_string()];
        let rust_only = search_bookmarks(&conn, &only_rust).unwrap();

        let mut both = default_request("");
        both.tags = vec!["rust".to_string(), "sqlite".to_string()];
        let both_results = search_bookmarks(&conn, &both).unwrap();

        assert_eq!(rust_only.bookmarks.len(), 1);
        assert_eq!(both_results.bookmarks.len(), 2);
        assert!(both_results.bookmarks.len() > rust_only.bookmarks.len());
        let ids: Vec<i64> = both_results.bookmarks.iter().map(|b| b.id).collect();
        assert!(ids.contains(&rust_bm) && ids.contains(&sqlite_bm));
    }

    #[test]
    fn text_and_tag_combine_by_intersection() {
        let conn = setup();
        let matching = create_bookmark(&conn, None, "grid пересечениеслово", "https://example.test/i1");
        tag_bookmark(&conn, matching, &["rust"]);
        let wrong_tag = create_bookmark(&conn, None, "grid пересечениеслово", "https://example.test/i2");
        tag_bookmark(&conn, wrong_tag, &["sqlite"]);

        let mut req = default_request("пересечениеслово");
        req.tags = vec!["rust".to_string()];
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 1);
        assert_eq!(results.bookmarks[0].id, matching);
    }

    #[test]
    fn text_with_zero_matches_and_wide_tags_gives_zero() {
        let conn = setup();
        let popular = create_bookmark(&conn, None, "многосовпадений", "https://example.test/z1");
        tag_bookmark(&conn, popular, &["popular"]);

        let mut req = default_request("несуществующийтокензапроса");
        req.tags = vec!["popular".to_string()];
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 0);
        assert_eq!(results.total, 0);
    }

    #[test]
    fn empty_tag_list_means_no_tag_filter() {
        let conn = setup();
        create_bookmark(&conn, None, "безтеговслово", "https://example.test/notag");

        let with_empty_tags = default_request("безтеговслово");
        let without_tags_field = default_request("безтеговслово");
        let a = search_bookmarks(&conn, &with_empty_tags).unwrap();
        let b = search_bookmarks(&conn, &without_tags_field).unwrap();
        assert_eq!(a.bookmarks.len(), b.bookmarks.len());
        assert_eq!(a.bookmarks.len(), 1);
    }

    #[test]
    fn cyrillic_tag_filter_is_case_insensitive() {
        let conn = setup();
        let bm = create_bookmark(&conn, None, "кириллическийтег", "https://example.test/cyr");
        tag_bookmark(&conn, bm, &["Работа"]);

        let mut lower = default_request("");
        lower.tags = vec!["работа".to_string()];
        let lower_results = search_bookmarks(&conn, &lower).unwrap();

        let mut upper = default_request("");
        upper.tags = vec!["РАБОТА".to_string()];
        let upper_results = search_bookmarks(&conn, &upper).unwrap();

        assert_eq!(lower_results.bookmarks.len(), 1);
        assert_eq!(upper_results.bookmarks.len(), 1);
        assert_eq!(lower_results.bookmarks[0].id, bm);
    }

    #[test]
    fn three_counts_stay_consistent_under_tag_only_filter() {
        let conn = setup();
        let parent = folders::create(&conn, "Родитель", None).unwrap();
        let inside = create_bookmark(&conn, Some(parent), "папкателслово1", "https://example.test/c1");
        tag_bookmark(&conn, inside, &["scoped"]);
        let outside = create_bookmark(&conn, None, "папкателслово2", "https://example.test/c2");
        tag_bookmark(&conn, outside, &["scoped"]);

        let mut req = default_request("");
        req.tags = vec!["scoped".to_string()];
        req.current_folder_id = Some(parent);
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.total_global, 2);
        assert_eq!(results.in_current_folder, 1);
        assert_eq!(results.bookmarks.len(), results.total as usize);
    }

    #[test]
    fn tag_value_is_bound_not_concatenated_into_sql() {
        let conn = setup();
        create_bookmark(&conn, None, "инъекцияслово", "https://example.test/inj");

        let mut req = default_request("");
        req.tags = vec!["'; DROP TABLE tags; --".to_string()];
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 0);

        let tags_still_exist: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert!(tags_still_exist >= 0);
    }

    #[test]
    fn title_highlight_wraps_match_and_is_plain_when_absent() {
        let conn = setup();
        create_bookmark(&conn, None, "яркийзаголовок статья", "https://example.test/h1");
        create_bookmark(&conn, None, "другая запись", "https://example.test/h2");

        let results = search_bookmarks(&conn, &default_request("яркийзаголовок")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        let hl = &results.highlights[0];
        assert!(hl.title.contains(HIGHLIGHT_OPEN));
        assert!(hl.title.contains(HIGHLIGHT_CLOSE));
        assert!(!hl.title.replace(HIGHLIGHT_OPEN, "").replace(HIGHLIGHT_CLOSE, "").is_empty());
    }

    #[test]
    fn host_highlight_marks_matching_substring() {
        let conn = setup();
        create_bookmark(&conn, None, "заголовок без совпадения", "https://searchhostword.test/page");

        let results = search_bookmarks(&conn, &default_request("searchhostword")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        assert!(results.highlights[0].host.contains(HIGHLIGHT_OPEN));
        assert!(!results.highlights[0].title.contains(HIGHLIGHT_OPEN));
    }

    #[test]
    fn description_only_match_gives_snippet_and_plain_title() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test/d1").unwrap();
        bookmarks::create(
            &conn,
            None,
            "обычныйзаголовок",
            &parsed,
            Some("полезное описаниесловоцель для теста"),
            None,
        )
        .unwrap();

        let results = search_bookmarks(&conn, &default_request("описаниесловоцель")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        let hl = &results.highlights[0];
        assert!(!hl.title.contains(HIGHLIGHT_OPEN));
        assert!(!hl.snippet.is_empty());
        assert!(hl.snippet.contains(HIGHLIGHT_OPEN));
    }

    #[test]
    fn description_only_match_highlights_whole_description() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test/dhl").unwrap();
        bookmarks::create(
            &conn,
            None,
            "простойзаголовок",
            &parsed,
            Some("полное описаниецельслово текста"),
            None,
        )
        .unwrap();

        let results = search_bookmarks(&conn, &default_request("описаниецельслово")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        let hl = &results.highlights[0];
        assert!(!hl.title.contains(HIGHLIGHT_OPEN));
        assert!(hl.description.contains(HIGHLIGHT_OPEN));
        assert!(hl.description.contains(HIGHLIGHT_CLOSE));
        assert_eq!(
            hl.description.replace(HIGHLIGHT_OPEN, "").replace(HIGHLIGHT_CLOSE, ""),
            "полное описаниецельслово текста"
        );
    }

    #[test]
    fn plain_description_has_no_markers_when_match_is_in_title() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test/dpl").unwrap();
        bookmarks::create(
            &conn,
            None,
            "заголовокцельслово статья",
            &parsed,
            Some("обычное описание без совпадений"),
            None,
        )
        .unwrap();

        let results = search_bookmarks(&conn, &default_request("заголовокцельслово")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        let hl = &results.highlights[0];
        assert!(hl.title.contains(HIGHLIGHT_OPEN));
        assert!(!hl.description.contains(HIGHLIGHT_OPEN));
        assert_eq!(hl.description, "обычное описание без совпадений");
    }

    #[test]
    fn url_only_match_raises_matched_in_url_flag() {
        let conn = setup();
        create_bookmark(&conn, None, "простойзаголовок", "https://example.test/путьсловоцель");

        let results = search_bookmarks(&conn, &default_request("путьсловоцель")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        assert!(results.highlights[0].matched_in_url);
    }

    #[test]
    fn host_and_url_match_does_not_raise_url_flag() {
        let conn = setup();
        create_bookmark(&conn, None, "простойзаголовок", "https://sharedwordhost.test/sharedwordhost");

        let results = search_bookmarks(&conn, &default_request("sharedwordhost")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        assert!(!results.highlights[0].matched_in_url);
    }

    #[test]
    fn two_matched_tags_are_both_returned() {
        let conn = setup();
        let id = create_bookmark(&conn, None, "многотеговаязакладка", "https://example.test/mt1");
        tag_bookmark(&conn, id, &["ластик", "ластиковый"]);

        let results = search_bookmarks(&conn, &default_request("ластик")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        let mut matched = results.highlights[0].matched_tags.clone();
        matched.sort();
        assert_eq!(matched, vec!["ластик".to_string(), "ластиковый".to_string()]);
    }

    #[test]
    fn multiword_tag_matches_as_whole_name_not_fragment() {
        let conn = setup();
        let id = create_bookmark(&conn, None, "мультитегзакладка", "https://example.test/mw1");
        tag_bookmark(&conn, id, &["web dev", "web"]);

        let results = search_bookmarks(&conn, &default_request("dev")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        assert_eq!(results.highlights[0].matched_tags, vec!["web dev".to_string()]);
    }

    #[test]
    fn prefix_token_matches_both_multiword_and_single_word_tag() {
        let conn = setup();
        let id = create_bookmark(&conn, None, "мультитегзакладкадва", "https://example.test/mw2");
        tag_bookmark(&conn, id, &["web dev", "web"]);

        let results = search_bookmarks(&conn, &default_request("web")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        let mut matched = results.highlights[0].matched_tags.clone();
        matched.sort();
        assert_eq!(matched, vec!["web".to_string(), "web dev".to_string()]);
    }

    #[test]
    fn cyrillic_multiword_tag_matches_last_token_prefix() {
        let conn = setup();
        let id = create_bookmark(&conn, None, "кириллическиймультитег", "https://example.test/mw3");
        tag_bookmark(&conn, id, &["веб дизайн"]);

        let results = search_bookmarks(&conn, &default_request("диз")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        assert_eq!(results.highlights[0].matched_tags, vec!["веб дизайн".to_string()]);
    }

    #[test]
    fn tag_only_search_leaves_matched_tags_empty() {
        let conn = setup();
        let id = create_bookmark(&conn, None, "тегтолькозакладка", "https://example.test/tagonly");
        tag_bookmark(&conn, id, &["only"]);

        let mut req = default_request("");
        req.tags = vec!["only".to_string()];
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 1);
        assert_eq!(results.highlights.len(), 1);
        assert!(results.highlights[0].matched_tags.is_empty());
        assert!(results.highlights[0].description.is_empty());
    }

    #[test]
    fn cyrillic_match_highlights_whole_token_case_insensitively() {
        let conn = setup();
        create_bookmark(&conn, None, "Гриды в вёрстке", "https://example.test/grid2");

        let results = search_bookmarks(&conn, &default_request("ГРИД")).unwrap();
        assert_eq!(results.highlights.len(), 1);
        let expected = format!("{HIGHLIGHT_OPEN}Гриды{HIGHLIGHT_CLOSE}");
        assert!(results.highlights[0].title.contains(&expected));
    }

    #[test]
    fn highlights_are_computed_only_for_the_returned_page() {
        let conn = setup();
        for i in 0..5 {
            create_bookmark(&conn, None, &format!("страницаслово{i}"), &format!("https://example.test/pg{i}"));
        }
        let mut req = default_request("страницаслово");
        req.limit = 2;
        req.offset = 0;
        let results = search_bookmarks(&conn, &req).unwrap();
        assert_eq!(results.bookmarks.len(), 2);
        assert_eq!(results.highlights.len(), 2);
        assert_eq!(results.total, 5);
    }

    #[test]
    fn folder_search_matches_by_name() {
        let conn = setup();
        folders::create(&conn, "уникальноеимяпапки", None).unwrap();
        folders::create(&conn, "прочая", None).unwrap();

        let results = search_folders(&conn, &default_request("уникальноеимяпапки")).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "уникальноеимяпапки");
    }

    #[test]
    fn folder_search_matches_by_description() {
        let conn = setup();
        let id = folders::create(&conn, "Папка", None).unwrap();
        folders::update(&conn, id, "Папка", Some("уникальноеописаниепапки"), None).unwrap();

        let results = search_folders(&conn, &default_request("уникальноеописаниепапки")).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, id);
    }

    #[test]
    fn folder_search_matches_by_tag() {
        let mut conn = setup();
        let id = folders::create(&conn, "Папка", None).unwrap();
        tags::set_for_folder(&mut conn, id, &["уникальныйтегпапки".to_string()]).unwrap();

        let results = search_folders(&conn, &default_request("уникальныйтегпапки")).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, id);
    }

    #[test]
    fn folder_tag_filter_unions_within_facet() {
        let mut conn = setup();
        let rust_folder = folders::create(&conn, "Rust папка", None).unwrap();
        tags::set_for_folder(&mut conn, rust_folder, &["rustfolder".to_string()]).unwrap();
        let sqlite_folder = folders::create(&conn, "Sqlite папка", None).unwrap();
        tags::set_for_folder(&mut conn, sqlite_folder, &["sqlitefolder".to_string()]).unwrap();

        let mut only_rust = default_request("");
        only_rust.tags = vec!["rustfolder".to_string()];
        let rust_only = search_folders(&conn, &only_rust).unwrap();

        let mut both = default_request("");
        both.tags = vec!["rustfolder".to_string(), "sqlitefolder".to_string()];
        let both_results = search_folders(&conn, &both).unwrap();

        assert_eq!(rust_only.len(), 1);
        assert_eq!(both_results.len(), 2);
    }

    #[test]
    fn folder_scope_narrows_by_same_path_prefix_as_bookmarks() {
        let conn = setup();
        let parent = folders::create(&conn, "Родитель", None).unwrap();
        let child = folders::create(&conn, "скоупслово вложенная", Some(parent)).unwrap();
        let outside = folders::create(&conn, "скоупслово снаружи", None).unwrap();

        let mut req = default_request("скоупслово");
        req.scope_folder_id = Some(parent);
        let results = search_folders(&conn, &req).unwrap();
        let ids: Vec<i64> = results.iter().map(|f| f.id).collect();
        assert!(ids.contains(&child));
        assert!(!ids.contains(&outside));
    }

    #[test]
    fn zero_folder_matches_returns_empty_vec_not_placeholder() {
        let conn = setup();
        folders::create(&conn, "обычнаяпапка", None).unwrap();

        let results = search_folders(&conn, &default_request("несуществующийтокензапроса")).unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn folder_row_shape_matches_children_row_shape() {
        let conn = setup();
        let parent = folders::create(&conn, "Родитель", None).unwrap();
        let id = folders::create(&conn, "формапапкислово", Some(parent)).unwrap();
        create_bookmark(&conn, Some(id), "внутри", "https://example.test/shape1");

        let found = search_folders(&conn, &default_request("формапапкислово")).unwrap();
        let contents = folders::children(&conn, Some(parent)).unwrap();
        let expected = contents.folders.iter().find(|f| f.id == id).unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, expected.id);
        assert_eq!(found[0].name, expected.name);
        assert_eq!(found[0].count, expected.count);
        assert_eq!(found[0].parent_id, expected.parent_id);
    }

    #[test]
    fn bookmark_in_third_level_folder_gets_root_to_leaf_path() {
        let conn = setup();
        let l1 = folders::create(&conn, "Первыйуровень", None).unwrap();
        let l2 = folders::create(&conn, "Второйуровень", Some(l1)).unwrap();
        let l3 = folders::create(&conn, "Третийуровень", Some(l2)).unwrap();
        create_bookmark(&conn, Some(l3), "путьсловоцель", "https://example.test/path3");

        let results = search_bookmarks(&conn, &default_request("путьсловоцель")).unwrap();
        assert_eq!(
            results.highlights[0].folder_path,
            vec!["Первыйуровень".to_string(), "Второйуровень".to_string(), "Третийуровень".to_string()]
        );
    }

    #[test]
    fn bookmark_in_root_gets_empty_folder_path() {
        let conn = setup();
        create_bookmark(&conn, None, "корневойпутьслово", "https://example.test/rootpath");

        let results = search_bookmarks(&conn, &default_request("корневойпутьслово")).unwrap();
        assert!(results.highlights[0].folder_path.is_empty());
    }

    #[test]
    fn bookmark_in_top_level_folder_gets_single_name_path() {
        let conn = setup();
        let top = folders::create(&conn, "Единственныйуровень", None).unwrap();
        create_bookmark(&conn, Some(top), "однимименемслово", "https://example.test/onelevel");

        let results = search_bookmarks(&conn, &default_request("однимименемслово")).unwrap();
        assert_eq!(results.highlights[0].folder_path, vec!["Единственныйуровень".to_string()]);
    }

    #[test]
    fn folder_name_with_slash_stays_one_segment() {
        let conn = setup();
        let odd = folders::create(&conn, "До/После", None).unwrap();
        create_bookmark(&conn, Some(odd), "слэшпапкаслово", "https://example.test/slashfolder");

        let results = search_bookmarks(&conn, &default_request("слэшпапкаслово")).unwrap();
        assert_eq!(results.highlights[0].folder_path, vec!["До/После".to_string()]);
    }

    #[test]
    fn folder_row_carries_highlighted_name() {
        let conn = setup();
        folders::create(&conn, "подсвеченноеимяпапки", None).unwrap();

        let results = search_bookmarks(&conn, &default_request("подсвеченноеимяпапки")).unwrap();
        assert_eq!(results.folder_matches.len(), 1);
        assert!(results.folder_matches[0].name_highlighted.contains(HIGHLIGHT_OPEN));
    }

    #[test]
    fn root_folder_row_has_empty_ancestor_path() {
        let conn = setup();
        folders::create(&conn, "корневаяпапкаслово", None).unwrap();

        let results = search_bookmarks(&conn, &default_request("корневаяпапкаслово")).unwrap();
        assert_eq!(results.folder_matches.len(), 1);
        assert!(results.folder_matches[0].path.is_empty());
    }

    #[test]
    fn dangling_folder_reference_in_path_is_skipped_not_fatal() {
        let conn = setup();
        let child = folders::create(&conn, "Дочерняяпуть", None).unwrap();
        create_bookmark(&conn, Some(child), "оборванныйпутьслово", "https://example.test/dangling");

        conn.execute(
            "UPDATE folders SET path = '/999999/' || id || '/' WHERE id = ?1",
            params![child],
        )
        .unwrap();

        let results = search_bookmarks(&conn, &default_request("оборванныйпутьслово")).unwrap();
        assert_eq!(results.highlights[0].folder_path, vec!["Дочерняяпуть".to_string()]);
    }
}
