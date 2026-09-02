use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupFolder {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub sort: i64,
    pub sort_key: Option<String>,
    pub sort_dir: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupBookmark {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub title: String,
    pub url: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub sort: i64,
    pub target_browser: Option<String>,
    pub target_profile: Option<String>,
    pub target_profile_name: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupImage {
    pub filename: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub app: String,
    pub schema: u32,
    pub exported_at: i64,
    pub folders: Vec<BackupFolder>,
    pub bookmarks: Vec<BackupBookmark>,
    pub images: Vec<BackupImage>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn build(conn: &Connection, images_dir: &Path) -> rusqlite::Result<Backup> {
    let mut folder_stmt = conn.prepare(
        "SELECT id, parent_id, name, description, image, sort, sort_key, sort_dir, \
         created_at, updated_at FROM folders ORDER BY id",
    )?;
    let mut folders = folder_stmt
        .query_map([], |row| {
            Ok(BackupFolder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                image: row.get(4)?,
                sort: row.get(5)?,
                sort_key: row.get(6)?,
                sort_dir: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for folder in folders.iter_mut() {
        folder.tags = crate::tags::for_folder(conn, folder.id)?;
    }

    let mut bookmark_stmt = conn.prepare(
        "SELECT id, folder_id, title, url, description, image, sort, target_browser, \
         target_profile, target_profile_name, created_at, updated_at FROM bookmarks ORDER BY id",
    )?;
    let mut bookmarks = bookmark_stmt
        .query_map([], |row| {
            Ok(BackupBookmark {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                title: row.get(2)?,
                url: row.get(3)?,
                description: row.get(4)?,
                image: row.get(5)?,
                sort: row.get(6)?,
                target_browser: row.get(7)?,
                target_profile: row.get(8)?,
                target_profile_name: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for bookmark in bookmarks.iter_mut() {
        bookmark.tags = crate::tags::for_bookmark(conn, bookmark.id)?;
    }

    let mut image_names: BTreeSet<String> = BTreeSet::new();
    for folder in &folders {
        if let Some(name) = &folder.image {
            image_names.insert(name.clone());
        }
    }
    for bookmark in &bookmarks {
        if let Some(name) = &bookmark.image {
            image_names.insert(name.clone());
        }
    }
    let mut images = Vec::new();
    for filename in &image_names {
        if let Ok(bytes) = std::fs::read(images_dir.join(filename)) {
            images.push(BackupImage {
                filename: filename.clone(),
                data: STANDARD.encode(bytes),
            });
        }
    }

    Ok(Backup {
        app: "trove".to_string(),
        schema: SCHEMA_VERSION,
        exported_at: now_secs(),
        folders,
        bookmarks,
        images,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::preview::PreviewOrigin;
    use crate::{bookmarks, folders, images, liveness, preview, tags, url_norm};
    use rusqlite::params;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn scratch_images_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trove-backup-test-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn build_of_empty_db_gives_valid_envelope() {
        let conn = setup();
        let images_dir = scratch_images_dir("empty");
        let backup = build(&conn, &images_dir).unwrap();

        assert_eq!(backup.app, "trove");
        assert_eq!(backup.schema, 1);
        assert!(backup.folders.is_empty());
        assert!(backup.bookmarks.is_empty());
        assert!(backup.images.is_empty());
    }

    #[test]
    fn build_contains_exact_folders_and_bookmarks_with_tags() {
        let mut conn = setup();
        let a = folders::create(&conn, "Дизайн", None).unwrap();
        let b = folders::create(&conn, "B", None).unwrap();
        tags::set_for_folder(&mut conn, a, &["ui".to_string()]).unwrap();

        let p1 = url_norm::parse("https://example.test/1").unwrap();
        let bm1 = bookmarks::create(&conn, Some(a), "Один", &p1, None, None).unwrap();
        let p2 = url_norm::parse("https://example.test/2").unwrap();
        bookmarks::create(&conn, Some(b), "Два", &p2, None, None).unwrap();
        let p3 = url_norm::parse("https://example.test/3").unwrap();
        bookmarks::create(&conn, None, "Три", &p3, None, None).unwrap();
        tags::set_for_bookmark(&mut conn, bm1, &["Работа".to_string()]).unwrap();

        let images_dir = scratch_images_dir("counts");
        let backup = build(&conn, &images_dir).unwrap();

        assert_eq!(backup.folders.len(), 2);
        assert_eq!(backup.bookmarks.len(), 3);
        let folder_a = backup.folders.iter().find(|f| f.name == "Дизайн").unwrap();
        assert_eq!(folder_a.tags, vec!["ui".to_string()]);
        let bookmark_1 = backup.bookmarks.iter().find(|b| b.title == "Один").unwrap();
        assert_eq!(bookmark_1.tags, vec!["Работа".to_string()]);
    }

    #[test]
    fn build_writes_tags_as_names_not_ids() {
        let mut conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        tags::set_for_folder(&mut conn, folder_id, &["zzz-not-an-id".to_string()]).unwrap();

        let images_dir = scratch_images_dir("tag-names");
        let backup = build(&conn, &images_dir).unwrap();

        assert_eq!(backup.folders[0].tags, vec!["zzz-not-an-id".to_string()]);
    }

    #[test]
    fn build_includes_target_browser_and_profile() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test/target").unwrap();
        let id = bookmarks::create(&conn, None, "Target", &parsed, None, None).unwrap();
        conn.execute(
            "UPDATE bookmarks SET target_browser = ?1, target_profile = ?2, target_profile_name = ?3 WHERE id = ?4",
            params!["chrome", "Default", "stillmvd", id],
        )
        .unwrap();

        let images_dir = scratch_images_dir("target");
        let backup = build(&conn, &images_dir).unwrap();

        let bookmark = &backup.bookmarks[0];
        assert_eq!(bookmark.target_browser.as_deref(), Some("chrome"));
        assert_eq!(bookmark.target_profile.as_deref(), Some("Default"));
        assert_eq!(bookmark.target_profile_name.as_deref(), Some("stillmvd"));
    }

    #[test]
    fn build_excludes_liveness_and_preview_fields() {
        let mut conn = setup();
        let parsed = url_norm::parse("https://example.test/liveness").unwrap();
        let id = bookmarks::create(&conn, None, "Checked", &parsed, None, None).unwrap();
        let written = liveness::Written {
            status: liveness::LinkStatus::Dead,
            reason: None,
            http_status: Some(404),
            fail_count: 4,
        };
        liveness::record_batch(&mut conn, &[(id, written)]).unwrap();
        preview::set_auto_preview(&conn, id, "auto-preview.png", PreviewOrigin::Og).unwrap();

        let images_dir = scratch_images_dir("no-liveness");
        let backup = build(&conn, &images_dir).unwrap();

        let json = serde_json::to_string(&backup).unwrap();
        assert!(!json.contains("dead"));
        assert!(!json.contains("auto-preview.png"));
    }

    #[test]
    fn build_dedupes_manual_image_referenced_by_two_records() {
        let conn = setup();
        let scratch = scratch_images_dir("dedupe");
        let images_dir = scratch.join("images");
        let source = scratch.join("source.png");
        std::fs::write(&source, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();
        let filename = images::import(&images_dir, &source).unwrap();

        let folder_id = folders::create(&conn, "A", None).unwrap();
        folders::update(&conn, folder_id, "A", None, Some(&filename)).unwrap();
        let parsed = url_norm::parse("https://example.test/shared-image").unwrap();
        bookmarks::create(&conn, None, "Shared", &parsed, None, Some(&filename)).unwrap();

        let backup = build(&conn, &images_dir).unwrap();

        assert_eq!(backup.images.len(), 1);
        assert_eq!(backup.images[0].filename, filename);
    }

    #[test]
    fn build_skips_missing_image_file_without_failing() {
        let conn = setup();
        let parsed = url_norm::parse("https://example.test/ghost").unwrap();
        bookmarks::create(&conn, None, "Ghost", &parsed, None, Some("nonexistent.png")).unwrap();

        let images_dir = scratch_images_dir("missing");
        let backup = build(&conn, &images_dir).unwrap();

        assert_eq!(backup.bookmarks.len(), 1);
        assert_eq!(backup.bookmarks[0].image.as_deref(), Some("nonexistent.png"));
        assert!(backup.images.is_empty());
    }
}
