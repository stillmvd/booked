use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::bookmarks::Bookmark;
use crate::favicons;
use crate::tags;

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
    let text_query = sanitize_fts_query(&req.text);
    let normalized_tags: Vec<String> = req
        .tags
        .iter()
        .map(|t| tags::normalize(t))
        .filter(|t| !t.is_empty())
        .collect();
    if text_query.is_none() && normalized_tags.is_empty() {
        return Ok(SearchResults { bookmarks: Vec::new(), total: 0, total_global: 0, in_current_folder: 0 });
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

    let order_by = match text_query {
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

    let select_sql = format!(
        "SELECT b.id, b.folder_id, b.title, b.url, b.url_normalized, b.description, b.image, \
         b.preview_file, b.preview_origin, b.preview_fetched_at, b.sort, b.created_at \
         {from_sql} \
         WHERE {select_where} \
         ORDER BY {order_by} \
         LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&select_sql)?;
    let mut bookmarks = stmt
        .query_map(params_from_iter(select_params.iter()), |row| {
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
}
