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
}

pub fn sanitize_fts_query(_input: &str) -> Option<String> {
    unimplemented!()
}

pub fn scope_prefix(_conn: &Connection, _folder_id: Option<i64>) -> rusqlite::Result<Option<String>> {
    unimplemented!()
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

pub fn search_bookmarks(_conn: &Connection, _req: &SearchRequest) -> rusqlite::Result<SearchResults> {
    unimplemented!()
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
}
