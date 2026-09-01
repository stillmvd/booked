use rusqlite::{params, Connection};

pub fn reorder(
    conn: &mut Connection,
    folder_id: Option<i64>,
    folder_ids: &[i64],
    bookmark_ids: &[i64],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for (position, id) in folder_ids.iter().enumerate() {
        tx.execute(
            "UPDATE folders SET sort = ?1 WHERE id = ?2 AND parent_id IS ?3",
            params![position as i64, id, folder_id],
        )?;
    }
    for (position, id) in bookmark_ids.iter().enumerate() {
        tx.execute(
            "UPDATE bookmarks SET sort = ?1 WHERE id = ?2 AND folder_id IS ?3",
            params![position as i64, id, folder_id],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bookmarks;
    use crate::db::migrate;
    use crate::folders;
    use crate::url_norm;
    use std::collections::HashSet;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn bookmark_in(conn: &Connection, folder_id: Option<i64>, title: &str, url: &str) -> i64 {
        let parsed = url_norm::parse(url).unwrap();
        bookmarks::create(conn, folder_id, title, &parsed, None, None).unwrap()
    }

    #[test]
    fn reorder_writes_dense_sort_and_bookmarks_in_folder_reflects_it() {
        let mut conn = setup();
        let folder = folders::create(&conn, "A", None).unwrap();
        let a = bookmark_in(&conn, Some(folder), "a", "https://example.test/a");
        let b = bookmark_in(&conn, Some(folder), "b", "https://example.test/b");
        let c = bookmark_in(&conn, Some(folder), "c", "https://example.test/c");

        reorder(&mut conn, Some(folder), &[], &[c, a, b]).unwrap();

        let ordered = bookmarks::in_folder(&conn, Some(folder)).unwrap();
        let ids: Vec<i64> = ordered.iter().map(|bk| bk.id).collect();
        assert_eq!(ids, vec![c, a, b]);
        let sorts: Vec<i64> = ordered.iter().map(|bk| bk.sort).collect();
        assert_eq!(sorts, vec![0, 1, 2]);
    }

    #[test]
    fn reorder_is_idempotent() {
        let mut conn = setup();
        let folder = folders::create(&conn, "A", None).unwrap();
        let a = bookmark_in(&conn, Some(folder), "a", "https://example.test/a");
        let b = bookmark_in(&conn, Some(folder), "b", "https://example.test/b");

        reorder(&mut conn, Some(folder), &[], &[b, a]).unwrap();
        let first: Vec<i64> = bookmarks::in_folder(&conn, Some(folder))
            .unwrap()
            .iter()
            .map(|bk| bk.sort)
            .collect();
        reorder(&mut conn, Some(folder), &[], &[b, a]).unwrap();
        let second: Vec<i64> = bookmarks::in_folder(&conn, Some(folder))
            .unwrap()
            .iter()
            .map(|bk| bk.sort)
            .collect();
        assert_eq!(first, second);
    }

    #[test]
    fn reorder_does_not_touch_bookmark_from_another_folder() {
        let mut conn = setup();
        let folder_a = folders::create(&conn, "A", None).unwrap();
        let folder_b = folders::create(&conn, "B", None).unwrap();
        let in_a = bookmark_in(&conn, Some(folder_a), "in-a", "https://example.test/in-a");
        let in_b = bookmark_in(&conn, Some(folder_b), "in-b", "https://example.test/in-b");

        reorder(&mut conn, Some(folder_a), &[], &[in_a, in_b]).unwrap();

        let b_sort: i64 = conn
            .query_row("SELECT sort FROM bookmarks WHERE id = ?1", params![in_b], |row| row.get(0))
            .unwrap();
        assert_eq!(b_sort, 0);
    }

    #[test]
    fn reorder_in_root_leaves_nested_rows_untouched() {
        let mut conn = setup();
        let folder = folders::create(&conn, "A", None).unwrap();
        let root_a = bookmark_in(&conn, None, "root-a", "https://example.test/root-a");
        let root_b = bookmark_in(&conn, None, "root-b", "https://example.test/root-b");
        let nested = bookmark_in(&conn, Some(folder), "nested", "https://example.test/nested");

        reorder(&mut conn, None, &[], &[root_b, root_a]).unwrap();

        let root_ids: Vec<i64> = bookmarks::in_folder(&conn, None)
            .unwrap()
            .iter()
            .map(|bk| bk.id)
            .collect();
        assert_eq!(root_ids, vec![root_b, root_a]);
        let nested_sort: i64 = conn
            .query_row("SELECT sort FROM bookmarks WHERE id = ?1", params![nested], |row| row.get(0))
            .unwrap();
        assert_eq!(nested_sort, 0);
    }

    #[test]
    fn reorder_numbers_folders_and_bookmarks_independently() {
        let mut conn = setup();
        let parent = folders::create(&conn, "Parent", None).unwrap();
        let child_a = folders::create(&conn, "child-a", Some(parent)).unwrap();
        let child_b = folders::create(&conn, "child-b", Some(parent)).unwrap();
        let bm_a = bookmark_in(&conn, Some(parent), "bm-a", "https://example.test/bm-a");
        let bm_b = bookmark_in(&conn, Some(parent), "bm-b", "https://example.test/bm-b");

        reorder(&mut conn, Some(parent), &[child_b, child_a], &[bm_b, bm_a]).unwrap();

        let folder_sort: i64 = conn
            .query_row("SELECT sort FROM folders WHERE id = ?1", params![child_b], |row| row.get(0))
            .unwrap();
        assert_eq!(folder_sort, 0);
        let bookmark_sort: i64 = conn
            .query_row("SELECT sort FROM bookmarks WHERE id = ?1", params![bm_b], |row| row.get(0))
            .unwrap();
        assert_eq!(bookmark_sort, 0);
    }

    #[test]
    fn reorder_on_empty_lists_is_a_successful_no_op() {
        let mut conn = setup();
        reorder(&mut conn, None, &[], &[]).unwrap();
    }

    #[test]
    fn reorder_of_500_bookmarks_gives_distinct_values_up_to_499() {
        let mut conn = setup();
        let folder = folders::create(&conn, "Big", None).unwrap();
        let mut ids = Vec::new();
        for i in 0..500 {
            ids.push(bookmark_in(&conn, Some(folder), &format!("bm-{i}"), &format!("https://example.test/bm-{i}")));
        }

        reorder(&mut conn, Some(folder), &[], &ids).unwrap();

        let mut stmt = conn.prepare("SELECT sort FROM bookmarks WHERE folder_id = ?1").unwrap();
        let sorts: Vec<i64> = stmt
            .query_map(params![folder], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(sorts.len(), 500);
        let distinct: HashSet<i64> = sorts.iter().copied().collect();
        assert_eq!(distinct.len(), 500);
        assert_eq!(*sorts.iter().max().unwrap(), 499);
    }

    #[test]
    fn reorder_does_not_change_fts_contents() {
        let mut conn = setup();
        let folder = folders::create(&conn, "A", None).unwrap();
        let a = bookmark_in(&conn, Some(folder), "Rust guide", "https://example.test/a");
        let b = bookmark_in(&conn, Some(folder), "Other page", "https://example.test/b");

        let count_before: i64 = conn.query_row("SELECT COUNT(*) FROM bookmarks_fts", [], |row| row.get(0)).unwrap();
        let match_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH 'Rust'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        reorder(&mut conn, Some(folder), &[], &[b, a]).unwrap();

        let count_after: i64 = conn.query_row("SELECT COUNT(*) FROM bookmarks_fts", [], |row| row.get(0)).unwrap();
        let match_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmarks_fts WHERE bookmarks_fts MATCH 'Rust'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_before, count_after);
        assert_eq!(match_before, match_after);
    }
}
