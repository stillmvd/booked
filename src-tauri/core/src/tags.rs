use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}

pub fn upsert(conn: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let normalized = normalize(name);
    conn.execute(
        "INSERT INTO tags (name, name_normalized) VALUES (?1, ?2) \
         ON CONFLICT(name_normalized) DO NOTHING",
        params![trimmed, normalized],
    )?;
    conn.query_row(
        "SELECT id FROM tags WHERE name_normalized = ?1",
        params![normalized],
        |row| row.get(0),
    )
    .map(Some)
}

pub fn set_for_folder(
    conn: &mut Connection,
    folder_id: i64,
    names: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    set_for_folder_tx(&tx, folder_id, names)?;
    tx.commit()
}

pub fn set_for_folder_tx(
    conn: &Connection,
    folder_id: i64,
    names: &[String],
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM folder_tags WHERE folder_id = ?1",
        params![folder_id],
    )?;
    for name in names {
        let Some(tag_id) = upsert(conn, name)? else {
            continue;
        };
        conn.execute(
            "INSERT OR IGNORE INTO folder_tags (folder_id, tag_id) VALUES (?1, ?2)",
            params![folder_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn for_folder(conn: &Connection, folder_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t JOIN folder_tags ft ON ft.tag_id = t.id \
         WHERE ft.folder_id = ?1 ORDER BY t.name",
    )?;
    let names = stmt
        .query_map(params![folder_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(names)
}

pub fn set_for_bookmark(
    conn: &mut Connection,
    bookmark_id: i64,
    names: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM bookmark_tags WHERE bookmark_id = ?1",
        params![bookmark_id],
    )?;
    for name in names {
        let Some(tag_id) = upsert(&tx, name)? else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?1, ?2)",
            params![bookmark_id, tag_id],
        )?;
    }
    tx.commit()
}

pub fn for_bookmark(conn: &Connection, bookmark_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t JOIN bookmark_tags bt ON bt.tag_id = t.id \
         WHERE bt.bookmark_id = ?1 ORDER BY t.name",
    )?;
    let names = stmt
        .query_map(params![bookmark_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(names)
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM tags ORDER BY name")?;
    let names = stmt
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(names)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

pub fn counts(conn: &Connection) -> rusqlite::Result<Vec<TagCount>> {
    let mut stmt = conn.prepare(
        "SELECT t.name, \
             (SELECT COUNT(*) FROM bookmark_tags bt WHERE bt.tag_id = t.id) + \
             (SELECT COUNT(*) FROM folder_tags ft WHERE ft.tag_id = t.id) AS cnt \
         FROM tags t \
         ORDER BY cnt DESC, t.name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TagCount {
            name: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagUsage {
    pub name: String,
    pub bookmarks: i64,
    pub folders: i64,
    pub games: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
pub enum TagTarget {
    Bookmark(i64),
    Folder(i64),
    Game(i64),
}

impl TagTarget {
    fn parts(self) -> (&'static str, &'static str, &'static str, i64) {
        match self {
            TagTarget::Bookmark(id) => ("bookmarks", "bookmark_tags", "bookmark_id", id),
            TagTarget::Folder(id) => ("folders", "folder_tags", "folder_id", id),
            TagTarget::Game(id) => ("games", "game_tags", "game_id", id),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    pub name: String,
    pub merged: bool,
}

#[derive(Debug)]
pub enum TagError {
    EmptyName,
    NoTag,
    NoTarget,
    Db(rusqlite::Error),
}

impl std::fmt::Display for TagError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TagError::EmptyName => write!(f, "Имя тега пустое"),
            TagError::NoTag => write!(f, "Этого тега уже нет"),
            TagError::NoTarget => write!(f, "Карточки уже нет"),
            TagError::Db(_) => write!(f, "Не удалось сохранить теги"),
        }
    }
}

impl From<rusqlite::Error> for TagError {
    fn from(e: rusqlite::Error) -> Self {
        TagError::Db(e)
    }
}

pub fn usage(conn: &Connection) -> rusqlite::Result<Vec<TagUsage>> {
    let mut stmt = conn.prepare(
        "SELECT t.name, COALESCE(b.n, 0), COALESCE(f.n, 0), COALESCE(g.n, 0) FROM tags t \
         LEFT JOIN (SELECT tag_id, COUNT(*) n FROM bookmark_tags GROUP BY tag_id) b ON b.tag_id = t.id \
         LEFT JOIN (SELECT tag_id, COUNT(*) n FROM folder_tags GROUP BY tag_id) f ON f.tag_id = t.id \
         LEFT JOIN (SELECT tag_id, COUNT(*) n FROM game_tags GROUP BY tag_id) g ON g.tag_id = t.id \
         ORDER BY t.name_normalized",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TagUsage {
            name: row.get(0)?,
            bookmarks: row.get(1)?,
            folders: row.get(2)?,
            games: row.get(3)?,
        })
    })?;
    rows.collect()
}

fn id_of(conn: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM tags WHERE name_normalized = ?1",
        params![normalize(name)],
        |row| row.get(0),
    )
    .optional()
}

fn refresh_copies(conn: &Connection, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE bookmarks SET tags = ( \
             SELECT COALESCE(group_concat(t.name, ' '), '') \
             FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id \
             WHERE bt.bookmark_id = bookmarks.id \
         ) WHERE id IN (SELECT bookmark_id FROM bookmark_tags WHERE tag_id = ?1)",
        params![tag_id],
    )?;
    conn.execute(
        "UPDATE folders SET tags = ( \
             SELECT COALESCE(group_concat(t.name, ' '), '') \
             FROM folder_tags ft JOIN tags t ON t.id = ft.tag_id \
             WHERE ft.folder_id = folders.id \
         ) WHERE id IN (SELECT folder_id FROM folder_tags WHERE tag_id = ?1)",
        params![tag_id],
    )?;
    Ok(())
}

pub fn rename(conn: &mut Connection, from: &str, to: &str) -> Result<RenameOutcome, TagError> {
    let to = to.trim();
    if to.is_empty() {
        return Err(TagError::EmptyName);
    }
    let tx = conn.transaction()?;
    let source = id_of(&tx, from)?.ok_or(TagError::NoTag)?;
    let kept = match id_of(&tx, to)? {
        Some(target) if target != source => {
            for (link, column) in [("bookmark_tags", "bookmark_id"), ("folder_tags", "folder_id"), ("game_tags", "game_id")] {
                tx.execute(
                    &format!("INSERT OR IGNORE INTO {link} ({column}, tag_id) SELECT {column}, ?1 FROM {link} WHERE tag_id = ?2"),
                    params![target, source],
                )?;
            }
            tx.execute("DELETE FROM tags WHERE id = ?1", params![source])?;
            target
        }
        _ => source,
    };
    tx.execute(
        "UPDATE tags SET name = ?1, name_normalized = ?2 WHERE id = ?3",
        params![to, normalize(to), kept],
    )?;
    refresh_copies(&tx, kept)?;
    tx.commit()?;
    Ok(RenameOutcome { name: to.to_string(), merged: kept != source })
}

pub fn delete(conn: &Connection, name: &str) -> Result<(), TagError> {
    match conn.execute("DELETE FROM tags WHERE name_normalized = ?1", params![normalize(name)])? {
        0 => Err(TagError::NoTag),
        _ => Ok(()),
    }
}

pub fn delete_unused(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM bookmark_tags) \
         AND id NOT IN (SELECT tag_id FROM folder_tags) \
         AND id NOT IN (SELECT tag_id FROM game_tags)",
        [],
    )
}

pub fn create(conn: &Connection, name: &str) -> Result<String, TagError> {
    let id = upsert(conn, name)?.ok_or(TagError::EmptyName)?;
    Ok(conn.query_row("SELECT name FROM tags WHERE id = ?1", params![id], |row| row.get(0))?)
}

fn ensure_target(conn: &Connection, target: TagTarget) -> Result<(), TagError> {
    let (owner, _, _, id) = target.parts();
    let found: bool = conn.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {owner} WHERE id = ?1)"),
        params![id],
        |row| row.get(0),
    )?;
    if found {
        Ok(())
    } else {
        Err(TagError::NoTarget)
    }
}

pub fn of_target(conn: &Connection, target: TagTarget) -> Result<Vec<String>, TagError> {
    ensure_target(conn, target)?;
    let (_, link, column, id) = target.parts();
    let mut stmt = conn.prepare(&format!(
        "SELECT t.name FROM tags t JOIN {link} l ON l.tag_id = t.id \
         WHERE l.{column} = ?1 ORDER BY t.name_normalized"
    ))?;
    let names = stmt.query_map(params![id], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(names)
}

pub fn toggle(conn: &mut Connection, target: TagTarget, name: &str, on: bool) -> Result<Vec<String>, TagError> {
    let tx = conn.transaction()?;
    ensure_target(&tx, target)?;
    let (_, link, column, id) = target.parts();
    if on {
        let tag_id = upsert(&tx, name)?.ok_or(TagError::EmptyName)?;
        tx.execute(
            &format!("INSERT OR IGNORE INTO {link} ({column}, tag_id) VALUES (?1, ?2)"),
            params![id, tag_id],
        )?;
    } else if let Some(tag_id) = id_of(&tx, name)? {
        tx.execute(
            &format!("DELETE FROM {link} WHERE {column} = ?1 AND tag_id = ?2"),
            params![id, tag_id],
        )?;
    }
    let names = of_target(&tx, target)?;
    tx.commit()?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::folders;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn set_for_folder_replaces_set() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();

        set_for_folder(
            &mut conn,
            folder_id,
            &["a".to_string(), "b".to_string()],
        )
        .unwrap();
        set_for_folder(&mut conn, folder_id, &["c".to_string()]).unwrap();

        let tags = for_folder(&conn, folder_id).unwrap();
        assert_eq!(tags, vec!["c".to_string()]);
    }

    #[test]
    fn tag_names_are_case_insensitive() {
        let conn = setup();
        let id1 = upsert(&conn, "Design").unwrap();
        let id2 = upsert(&conn, "design").unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn cyrillic_tag_names_are_case_insensitive() {
        let conn = setup();
        let id1 = upsert(&conn, "Работа").unwrap();
        let id2 = upsert(&conn, "работа").unwrap();
        let id3 = upsert(&conn, "РАБОТА").unwrap();
        assert_eq!(id1, id2);
        assert_eq!(id1, id3);

        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn upsert_preserves_original_casing_for_display() {
        let conn = setup();
        upsert(&conn, "GitHub").unwrap();
        upsert(&conn, "github").unwrap();

        let stored: String = conn
            .query_row("SELECT name FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, "GitHub");
    }

    #[test]
    fn upsert_of_blank_name_returns_none_and_creates_no_row() {
        let conn = setup();
        let id = upsert(&conn, "   ").unwrap();
        assert_eq!(id, None);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn set_for_folder_skips_blank_tag_names() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();

        set_for_folder(&mut conn, folder_id, &["ui".to_string(), "   ".to_string(), "".to_string()])
            .unwrap();

        let tags = for_folder(&conn, folder_id).unwrap();
        assert_eq!(tags, vec!["ui".to_string()]);
    }

    #[test]
    fn deleting_folder_cascades_links() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();
        set_for_folder(&mut conn, folder_id, &["ui".to_string()]).unwrap();

        conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM folder_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn set_for_bookmark_replaces_set() {
        use crate::bookmarks;
        use crate::url_norm;

        let conn = setup();
        let parsed = url_norm::parse("https://example.test").unwrap();
        let bookmark_id = bookmarks::create(&conn, None, "Example", &parsed, None, None).unwrap();

        let mut conn = conn;
        set_for_bookmark(&mut conn, bookmark_id, &["a".to_string(), "b".to_string()]).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["c".to_string()]).unwrap();

        let tags = for_bookmark(&conn, bookmark_id).unwrap();
        assert_eq!(tags, vec!["c".to_string()]);
    }

    #[test]
    fn deleting_bookmark_cascades_tag_links() {
        use crate::bookmarks;
        use crate::url_norm;

        let mut conn = setup();
        let parsed = url_norm::parse("https://example.test").unwrap();
        let bookmark_id = bookmarks::create(&conn, None, "Example", &parsed, None, None).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["ui".to_string()]).unwrap();

        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bookmark_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn counts_sums_bookmark_and_folder_links() {
        use crate::bookmarks;
        use crate::url_norm;

        let mut conn = setup();
        let folder_id = folders::create(&conn, "Design", None).unwrap();
        set_for_folder(&mut conn, folder_id, &["shared".to_string()]).unwrap();

        let parsed = url_norm::parse("https://example.test").unwrap();
        let bookmark_id = bookmarks::create(&conn, None, "Example", &parsed, None, None).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["shared".to_string()]).unwrap();

        let all = counts(&conn).unwrap();
        let shared = all.iter().find(|c| c.name == "shared").unwrap();
        assert_eq!(shared.count, 2);
    }

    #[test]
    fn counts_sorts_by_count_descending_then_by_name() {
        let mut conn = setup();
        let a = folders::create(&conn, "A", None).unwrap();
        let b = folders::create(&conn, "B", None).unwrap();
        let c = folders::create(&conn, "C", None).unwrap();
        set_for_folder(&mut conn, a, &["popular".to_string(), "zeta".to_string()]).unwrap();
        set_for_folder(&mut conn, b, &["popular".to_string(), "alpha".to_string()]).unwrap();
        set_for_folder(&mut conn, c, &["popular".to_string()]).unwrap();

        let all = counts(&conn).unwrap();
        let names: Vec<&str> = all.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["popular", "alpha", "zeta"]);
    }

    #[test]
    fn unattached_tag_has_zero_count_and_is_present() {
        let conn = setup();
        upsert(&conn, "одинокий").unwrap();

        let all = counts(&conn).unwrap();
        let lonely = all.iter().find(|c| c.name == "одинокий").unwrap();
        assert_eq!(lonely.count, 0);
    }

    #[test]
    fn cyrillic_tags_give_one_combined_count() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "Работа", None).unwrap();
        set_for_folder(&mut conn, folder_id, &["Работа".to_string()]).unwrap();

        let parsed = crate::url_norm::parse("https://example.test/w").unwrap();
        let bookmark_id =
            crate::bookmarks::create(&conn, None, "Пример", &parsed, None, None).unwrap();
        set_for_bookmark(&mut conn, bookmark_id, &["работа".to_string()]).unwrap();

        let all = counts(&conn).unwrap();
        let matches: Vec<_> = all.iter().filter(|c| c.name.to_lowercase() == "работа").collect();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].count, 2);
    }

    fn bookmark(conn: &Connection, n: i64) -> i64 {
        let parsed = crate::url_norm::parse(&format!("https://example.test/{n}")).unwrap();
        crate::bookmarks::create(conn, None, &format!("Страница {n}"), &parsed, None, None).unwrap()
    }

    fn game(conn: &Connection, base: &str) -> i64 {
        conn.execute("INSERT INTO games (base_name, title) VALUES (?1, ?1)", params![base]).unwrap();
        conn.last_insert_rowid()
    }

    fn put(conn: &mut Connection, target: TagTarget, names: &[&str]) {
        for name in names {
            toggle(conn, target, name, true).unwrap();
        }
    }

    fn found(conn: &Connection, text: &str) -> (i64, usize) {
        let req = crate::search::SearchRequest {
            text: text.to_string(),
            tags: Vec::new(),
            scope_folder_id: None,
            current_folder_id: None,
            sort: crate::search::SearchSort::Relevance,
            limit: 50,
            offset: 0,
        };
        let bookmarks = crate::search::search_bookmarks(conn, &req).unwrap().total;
        let folders = crate::search::search_folders(conn, &req).unwrap().len();
        (bookmarks, folders)
    }

    fn usage_of(conn: &Connection, name: &str) -> Option<(i64, i64, i64)> {
        usage(conn)
            .unwrap()
            .into_iter()
            .find(|u| u.name == name)
            .map(|u| (u.bookmarks, u.folders, u.games))
    }

    fn tag_rows(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn usage_counts_bookmarks_folders_and_games_separately() {
        let mut conn = setup();
        let b1 = bookmark(&conn, 1);
        let b2 = bookmark(&conn, 2);
        let f = folders::create(&conn, "Ранобэ", None).unwrap();
        let g = game(&conn, "pnc");
        put(&mut conn, TagTarget::Bookmark(b1), &["игры"]);
        put(&mut conn, TagTarget::Bookmark(b2), &["игры"]);
        put(&mut conn, TagTarget::Folder(f), &["игры"]);
        put(&mut conn, TagTarget::Game(g), &["игры", "перевод"]);
        upsert(&conn, "новелла").unwrap();

        assert_eq!(usage_of(&conn, "игры"), Some((2, 1, 1)));
        assert_eq!(usage_of(&conn, "перевод"), Some((0, 0, 1)));
        assert_eq!(usage_of(&conn, "новелла"), Some((0, 0, 0)));
    }

    #[test]
    fn rename_cyrillic_tag_moves_every_card_and_search() {
        let mut conn = setup();
        let b = bookmark(&conn, 1);
        let f = folders::create(&conn, "Макеты", None).unwrap();
        let g = game(&conn, "pnc");
        put(&mut conn, TagTarget::Bookmark(b), &["дизайн", "шрифты"]);
        put(&mut conn, TagTarget::Folder(f), &["дизайн"]);
        put(&mut conn, TagTarget::Game(g), &["дизайн"]);
        assert_eq!(found(&conn, "дизайн"), (1, 1));

        let outcome = rename(&mut conn, "Дизайн", "  Интерфейс ").unwrap();

        assert_eq!(outcome, RenameOutcome { name: "Интерфейс".to_string(), merged: false });
        assert_eq!(of_target(&conn, TagTarget::Bookmark(b)).unwrap(), vec!["Интерфейс", "шрифты"]);
        assert_eq!(of_target(&conn, TagTarget::Folder(f)).unwrap(), vec!["Интерфейс"]);
        assert_eq!(of_target(&conn, TagTarget::Game(g)).unwrap(), vec!["Интерфейс"]);
        assert_eq!(usage_of(&conn, "Интерфейс"), Some((1, 1, 1)));
        assert_eq!(usage_of(&conn, "дизайн"), None);
        assert_eq!(found(&conn, "интерфейс"), (1, 1));
        assert_eq!(found(&conn, "дизайн"), (0, 0));
        assert_eq!(found(&conn, "шрифты"), (1, 0));
    }

    #[test]
    fn rename_case_only_keeps_the_tag_without_merge() {
        let mut conn = setup();
        let b = bookmark(&conn, 1);
        put(&mut conn, TagTarget::Bookmark(b), &["игры"]);

        let outcome = rename(&mut conn, "игры", "Игры").unwrap();

        assert_eq!(outcome, RenameOutcome { name: "Игры".to_string(), merged: false });
        assert_eq!(tag_rows(&conn), 1);
        assert_eq!(of_target(&conn, TagTarget::Bookmark(b)).unwrap(), vec!["Игры"]);
        let copy: String = conn.query_row("SELECT tags FROM bookmarks WHERE id = ?1", params![b], |row| row.get(0)).unwrap();
        assert_eq!(copy, "Игры");
    }

    #[test]
    fn rename_into_taken_name_merges_without_duplicates() {
        let mut conn = setup();
        let shared = bookmark(&conn, 1);
        let only_old = bookmark(&conn, 2);
        let only_new = bookmark(&conn, 3);
        let f = folders::create(&conn, "Архив", None).unwrap();
        let g = game(&conn, "pnc");
        put(&mut conn, TagTarget::Bookmark(shared), &["кино", "Фильмы"]);
        put(&mut conn, TagTarget::Bookmark(only_old), &["кино"]);
        put(&mut conn, TagTarget::Bookmark(only_new), &["Фильмы"]);
        put(&mut conn, TagTarget::Folder(f), &["кино"]);
        put(&mut conn, TagTarget::Game(g), &["кино", "Фильмы"]);

        let outcome = rename(&mut conn, "кино", "фильмы").unwrap();

        assert_eq!(outcome, RenameOutcome { name: "фильмы".to_string(), merged: true });
        assert_eq!(tag_rows(&conn), 1);
        assert_eq!(usage_of(&conn, "фильмы"), Some((3, 1, 1)));
        assert_eq!(of_target(&conn, TagTarget::Bookmark(shared)).unwrap(), vec!["фильмы"]);
        assert_eq!(of_target(&conn, TagTarget::Game(g)).unwrap(), vec!["фильмы"]);
        assert_eq!(found(&conn, "фильмы"), (3, 1));
        assert_eq!(found(&conn, "кино"), (0, 0));
    }

    #[test]
    fn rename_errors_leave_tags_untouched() {
        let mut conn = setup();
        let b = bookmark(&conn, 1);
        put(&mut conn, TagTarget::Bookmark(b), &["игры"]);

        assert_eq!(rename(&mut conn, "игры", "   ").unwrap_err().to_string(), "Имя тега пустое");
        assert_eq!(rename(&mut conn, "нет такого", "игры").unwrap_err().to_string(), "Этого тега уже нет");
        assert_eq!(of_target(&conn, TagTarget::Bookmark(b)).unwrap(), vec!["игры"]);
    }

    #[test]
    fn delete_cascades_links_and_search_copy() {
        let mut conn = setup();
        let b = bookmark(&conn, 1);
        let f = folders::create(&conn, "Макеты", None).unwrap();
        let g = game(&conn, "pnc");
        put(&mut conn, TagTarget::Bookmark(b), &["дизайн", "шрифты"]);
        put(&mut conn, TagTarget::Folder(f), &["дизайн"]);
        put(&mut conn, TagTarget::Game(g), &["дизайн"]);

        delete(&conn, "ДИЗАЙН").unwrap();

        assert_eq!(usage_of(&conn, "дизайн"), None);
        assert_eq!(of_target(&conn, TagTarget::Bookmark(b)).unwrap(), vec!["шрифты"]);
        assert!(of_target(&conn, TagTarget::Game(g)).unwrap().is_empty());
        let copy: String = conn.query_row("SELECT tags FROM bookmarks WHERE id = ?1", params![b], |row| row.get(0)).unwrap();
        assert_eq!(copy, "шрифты");
        assert_eq!(found(&conn, "дизайн"), (0, 0));
        assert_eq!(delete(&conn, "дизайн").unwrap_err().to_string(), "Этого тега уже нет");
    }

    #[test]
    fn delete_unused_keeps_tags_used_anywhere() {
        let mut conn = setup();
        let b = bookmark(&conn, 1);
        let f = folders::create(&conn, "Ранобэ", None).unwrap();
        let g = game(&conn, "pnc");
        put(&mut conn, TagTarget::Bookmark(b), &["закладочный"]);
        put(&mut conn, TagTarget::Folder(f), &["папочный"]);
        put(&mut conn, TagTarget::Game(g), &["игровой"]);
        upsert(&conn, "визуальная новелла").unwrap();
        upsert(&conn, "новелла").unwrap();

        assert_eq!(delete_unused(&conn).unwrap(), 2);

        let names: Vec<String> = usage(&conn).unwrap().into_iter().map(|u| u.name).collect();
        assert_eq!(names, vec!["закладочный", "игровой", "папочный"]);
        assert_eq!(delete_unused(&conn).unwrap(), 0);
    }

    #[test]
    fn create_trims_and_returns_existing_name() {
        let conn = setup();
        assert_eq!(create(&conn, "  Хоррор ").unwrap(), "Хоррор");
        assert_eq!(create(&conn, "хоррор").unwrap(), "Хоррор");
        assert_eq!(tag_rows(&conn), 1);
        assert_eq!(usage_of(&conn, "Хоррор"), Some((0, 0, 0)));
        assert_eq!(create(&conn, " ").unwrap_err().to_string(), "Имя тега пустое");
    }

    #[test]
    fn toggle_touches_only_one_link_of_one_card() {
        let mut conn = setup();
        let mine = folders::create(&conn, "Ранобэ", None).unwrap();
        let other = folders::create(&conn, "Манга", None).unwrap();
        put(&mut conn, TagTarget::Folder(mine), &["прочитать потом", "Япония"]);
        put(&mut conn, TagTarget::Folder(other), &["Япония"]);

        let after_off = toggle(&mut conn, TagTarget::Folder(mine), "япония", false).unwrap();
        assert_eq!(after_off, vec!["прочитать потом"]);
        assert_eq!(of_target(&conn, TagTarget::Folder(other)).unwrap(), vec!["Япония"]);

        let after_on = toggle(&mut conn, TagTarget::Folder(mine), " Хоррор ", true).unwrap();
        assert_eq!(after_on, vec!["прочитать потом", "Хоррор"]);
        assert_eq!(toggle(&mut conn, TagTarget::Folder(mine), "хоррор", true).unwrap(), after_on);
        assert_eq!(found(&conn, "хоррор"), (0, 1));

        let g = game(&conn, "pnc");
        assert_eq!(toggle(&mut conn, TagTarget::Game(g), "Япония", true).unwrap(), vec!["Япония"]);
        assert_eq!(usage_of(&conn, "Япония"), Some((0, 1, 1)));
        assert_eq!(toggle(&mut conn, TagTarget::Game(g), "Япония", false).unwrap(), Vec::<String>::new());
        assert_eq!(usage_of(&conn, "Япония"), Some((0, 1, 0)));
    }

    #[test]
    fn missing_card_is_reported_in_plain_words() {
        let mut conn = setup();
        let b = bookmark(&conn, 1);
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![b]).unwrap();

        for target in [TagTarget::Bookmark(b), TagTarget::Folder(404), TagTarget::Game(404)] {
            assert_eq!(of_target(&conn, target).unwrap_err().to_string(), "Карточки уже нет");
            assert_eq!(toggle(&mut conn, target, "игры", true).unwrap_err().to_string(), "Карточки уже нет");
        }
        assert_eq!(tag_rows(&conn), 0);
        let f = folders::create(&conn, "Ранобэ", None).unwrap();
        assert_eq!(toggle(&mut conn, TagTarget::Folder(f), "", true).unwrap_err().to_string(), "Имя тега пустое");
    }

    #[test]
    fn tag_target_reads_kind_and_id() {
        let target: TagTarget = serde_json::from_str(r#"{"kind":"game","id":7}"#).unwrap();
        assert_eq!(target, TagTarget::Game(7));
        let target: TagTarget = serde_json::from_str(r#"{"kind":"bookmark","id":3}"#).unwrap();
        assert_eq!(target, TagTarget::Bookmark(3));
    }
}
