use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::bookmarks::Bookmark;
use crate::favicons;

pub type SearchHit = Bookmark;

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
}

pub fn sanitize_fts_query(input: &str) -> Option<String> {
    let tokens: Vec<&str> = input
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
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

pub fn search_bookmarks(conn: &Connection, req: &SearchRequest) -> rusqlite::Result<SearchResults> {
    let Some(query) = sanitize_fts_query(&req.text) else {
        return Ok(SearchResults { bookmarks: Vec::new(), total: 0, total_global: 0, in_current_folder: 0 });
    };
    let scope = scope_prefix(conn, req.scope_folder_id)?;
    let scope_param = scope.map(|path| format!("{path}%"));
    let current_folder_scope = scope_prefix(conn, req.current_folder_id)?;
    let current_folder_param = current_folder_scope.map(|path| format!("{path}%"));

    let order_by = match req.sort {
        SearchSort::Relevance => "bm25(bookmarks_fts, 10.0, 4.0, 2.0, 3.0, 1.0) ASC",
        SearchSort::Date => "b.created_at DESC",
    };

    let (total, total_global, in_current_folder): (i64, i64, i64) = conn.query_row(
        "SELECT \
             COALESCE(SUM(CASE WHEN (?2 IS NULL OR f.path LIKE ?2) THEN 1 ELSE 0 END), 0), \
             COUNT(*), \
             COALESCE(SUM(CASE WHEN (?3 IS NOT NULL AND f.path LIKE ?3) THEN 1 ELSE 0 END), 0) \
         FROM bookmarks_fts \
         JOIN bookmarks b ON b.id = bookmarks_fts.rowid \
         LEFT JOIN folders f ON f.id = b.folder_id \
         WHERE bookmarks_fts MATCH ?1",
        params![query, scope_param, current_folder_param],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    let select_sql = format!(
        "SELECT b.id, b.folder_id, b.title, b.url, b.url_normalized, b.description, b.image, \
         b.preview_file, b.preview_origin, b.preview_fetched_at, b.sort, b.created_at \
         FROM bookmarks_fts \
         JOIN bookmarks b ON b.id = bookmarks_fts.rowid \
         LEFT JOIN folders f ON f.id = b.folder_id \
         WHERE bookmarks_fts MATCH ?1 AND (?2 IS NULL OR f.path LIKE ?2) \
         ORDER BY {order_by} \
         LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn.prepare(&select_sql)?;
    let mut bookmarks = stmt
        .query_map(params![query, scope_param, req.limit, req.offset], |row| {
            Ok(Bookmark {
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
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

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

    Ok(SearchResults { bookmarks, total, total_global, in_current_folder })
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
}
