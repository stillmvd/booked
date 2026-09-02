use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
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

pub const MAX_BACKUP_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_IMAGE_DECODED_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub enum BackupError {
    NotTroveBackup,
    NewerSchema { found: u32, supported: u32 },
    TooLarge,
    BrokenImage(String),
    BrokenReference(String),
    Io(String),
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackupError::NotTroveBackup => write!(f, "Этот файл не похож на выгрузку Trove"),
            BackupError::NewerSchema { found, supported } => write!(
                f,
                "Этот файл сделан более новой версией Trove (версия {found}, эта версия понимает до {supported})"
            ),
            BackupError::TooLarge => write!(f, "Файл слишком большой для импорта"),
            BackupError::BrokenImage(name) => write!(f, "Картинка «{name}» в файле повреждена"),
            BackupError::BrokenReference(message) => write!(f, "{message}"),
            BackupError::Io(message) => write!(f, "Не удалось применить импорт: {message}"),
        }
    }
}

impl From<rusqlite::Error> for BackupError {
    fn from(e: rusqlite::Error) -> Self {
        BackupError::Io(e.to_string())
    }
}

impl From<std::io::Error> for BackupError {
    fn from(e: std::io::Error) -> Self {
        BackupError::Io(e.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub folders: usize,
    pub bookmarks: usize,
    pub exported_at: i64,
}

pub fn summary(backup: &Backup) -> BackupSummary {
    BackupSummary {
        folders: backup.folders.len(),
        bookmarks: backup.bookmarks.len(),
        exported_at: backup.exported_at,
    }
}

pub fn parse(bytes: &[u8]) -> Result<Backup, BackupError> {
    parse_within(bytes, MAX_BACKUP_BYTES, MAX_IMAGE_DECODED_BYTES)
}

fn parse_within(bytes: &[u8], max_bytes: usize, max_image_bytes: usize) -> Result<Backup, BackupError> {
    if bytes.len() > max_bytes {
        return Err(BackupError::TooLarge);
    }

    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| BackupError::NotTroveBackup)?;

    let app = value.get("app").and_then(|v| v.as_str());
    if app != Some("trove") {
        return Err(BackupError::NotTroveBackup);
    }

    let schema = value
        .get("schema")
        .and_then(|v| v.as_u64())
        .ok_or(BackupError::NotTroveBackup)? as u32;
    if schema > SCHEMA_VERSION {
        return Err(BackupError::NewerSchema { found: schema, supported: SCHEMA_VERSION });
    }

    let backup: Backup = serde_json::from_value(value).map_err(|_| BackupError::NotTroveBackup)?;

    for image in &backup.images {
        if !crate::images::is_valid_image_filename(&image.filename) {
            return Err(BackupError::BrokenImage(image.filename.clone()));
        }
        let approx_decoded_len = image.data.len() / 4 * 3;
        if approx_decoded_len > max_image_bytes {
            return Err(BackupError::TooLarge);
        }
        let decoded = STANDARD
            .decode(&image.data)
            .map_err(|_| BackupError::BrokenImage(image.filename.clone()))?;
        if decoded.len() > max_image_bytes {
            return Err(BackupError::TooLarge);
        }
        if crate::images::detect_extension(&decoded).is_none() {
            return Err(BackupError::BrokenImage(image.filename.clone()));
        }
    }

    Ok(backup)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    Replace,
    Merge,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub folders: i64,
    pub bookmarks: i64,
}

fn set_bookmark_tags(conn: &Connection, bookmark_id: i64, names: &[String]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM bookmark_tags WHERE bookmark_id = ?1", params![bookmark_id])?;
    for name in names {
        if let Some(tag_id) = crate::tags::upsert(conn, name)? {
            conn.execute(
                "INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?1, ?2)",
                params![bookmark_id, tag_id],
            )?;
        }
    }
    Ok(())
}

fn find_folder_id(conn: &Connection, parent_db_id: Option<i64>, name: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM folders WHERE parent_id IS ?1 AND name = ?2 LIMIT 1",
        params![parent_db_id, name],
        |row| row.get(0),
    )
    .optional()
}

fn resolve_folder(
    conn: &Connection,
    mode: ImportMode,
    folder: &BackupFolder,
    parent_db_id: Option<i64>,
) -> rusqlite::Result<(i64, bool)> {
    if let ImportMode::Merge = mode {
        if let Some(existing_id) = find_folder_id(conn, parent_db_id, &folder.name)? {
            return Ok((existing_id, false));
        }
    }
    let id = crate::folders::create(conn, &folder.name, parent_db_id)?;
    crate::folders::update(conn, id, &folder.name, folder.description.as_deref(), folder.image.as_deref())?;
    crate::tags::set_for_folder_tx(conn, id, &folder.tags)?;
    conn.execute(
        "UPDATE folders SET sort = ?1, sort_key = ?2, sort_dir = ?3 WHERE id = ?4",
        params![folder.sort, folder.sort_key, folder.sort_dir, id],
    )?;
    Ok((id, true))
}

pub fn apply(
    conn: &mut Connection,
    backup: &Backup,
    mode: ImportMode,
    images_dir: &Path,
) -> Result<Applied, BackupError> {
    for image in &backup.images {
        let bytes = STANDARD
            .decode(&image.data)
            .map_err(|_| BackupError::BrokenImage(image.filename.clone()))?;
        std::fs::create_dir_all(images_dir)?;
        std::fs::write(images_dir.join(&image.filename), &bytes)?;
    }

    let tx = conn.transaction()?;

    if let ImportMode::Replace = mode {
        tx.execute_batch(
            "DELETE FROM bookmark_tags; DELETE FROM folder_tags; DELETE FROM bookmarks; \
             DELETE FROM folders; DELETE FROM tags;",
        )?;
    }

    let mut id_map: HashMap<i64, i64> = HashMap::new();
    let mut applied_folders = 0i64;
    let mut remaining: Vec<&BackupFolder> = backup.folders.iter().collect();
    while !remaining.is_empty() {
        let mut next_remaining = Vec::new();
        let mut progressed = false;
        for folder in remaining {
            let parent_db_id = match folder.parent_id {
                None => None,
                Some(file_parent_id) => match id_map.get(&file_parent_id) {
                    Some(db_id) => Some(*db_id),
                    None => {
                        next_remaining.push(folder);
                        continue;
                    }
                },
            };
            let (db_id, created) = resolve_folder(&tx, mode, folder, parent_db_id)?;
            id_map.insert(folder.id, db_id);
            if created {
                applied_folders += 1;
            }
            progressed = true;
        }
        if !progressed {
            return Err(BackupError::BrokenReference(
                "часть папок в файле ссылается на несуществующего родителя".to_string(),
            ));
        }
        remaining = next_remaining;
    }

    let mut applied_bookmarks = 0i64;
    for bookmark in &backup.bookmarks {
        let folder_db_id = match bookmark.folder_id {
            None => None,
            Some(file_folder_id) => match id_map.get(&file_folder_id) {
                Some(db_id) => Some(*db_id),
                None => {
                    return Err(BackupError::BrokenReference(format!(
                        "закладка «{}» ссылается на несуществующую папку",
                        bookmark.title
                    )))
                }
            },
        };
        let parsed = crate::url_norm::parse(&bookmark.url).map_err(|_| {
            BackupError::BrokenReference(format!("у закладки «{}» непригодный адрес", bookmark.title))
        })?;

        if let ImportMode::Merge = mode {
            if let Some(hit) = crate::bookmarks::find_by_normalized(&tx, &parsed.normalized)? {
                let description = bookmark.description.as_deref().filter(|d| !d.is_empty());
                tx.execute(
                    "UPDATE bookmarks SET title = ?1, description = ?2, updated_at = unixepoch() WHERE id = ?3",
                    params![bookmark.title, description, hit.id],
                )?;
                set_bookmark_tags(&tx, hit.id, &bookmark.tags)?;
                applied_bookmarks += 1;
                continue;
            }
        }

        let id = crate::bookmarks::create(
            &tx,
            folder_db_id,
            &bookmark.title,
            &parsed,
            bookmark.description.as_deref(),
            bookmark.image.as_deref(),
        )?;
        tx.execute(
            "UPDATE bookmarks SET sort = ?1, target_browser = ?2, target_profile = ?3, \
             target_profile_name = ?4 WHERE id = ?5",
            params![bookmark.sort, bookmark.target_browser, bookmark.target_profile, bookmark.target_profile_name, id],
        )?;
        set_bookmark_tags(&tx, id, &bookmark.tags)?;
        applied_bookmarks += 1;
    }

    tx.commit()?;

    Ok(Applied { folders: applied_folders, bookmarks: applied_bookmarks })
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

    fn valid_backup_json() -> String {
        serde_json::json!({
            "app": "trove",
            "schema": 1,
            "exportedAt": 1_700_000_000_i64,
            "folders": [],
            "bookmarks": [],
            "images": []
        })
        .to_string()
    }

    #[test]
    fn parse_rejects_empty_bytes() {
        let err = parse(b"").unwrap_err();
        assert_eq!(err, BackupError::NotTroveBackup);
        assert_eq!(err.to_string(), "Этот файл не похож на выгрузку Trove");
    }

    #[test]
    fn parse_rejects_truncated_json() {
        let full = valid_backup_json();
        let truncated = &full.as_bytes()[..full.len() / 2];
        let err = parse(truncated).unwrap_err();
        assert_eq!(err, BackupError::NotTroveBackup);
    }

    #[test]
    fn parse_rejects_non_json() {
        let err = parse(b"this is definitely not json").unwrap_err();
        assert_eq!(err, BackupError::NotTroveBackup);
    }

    #[test]
    fn parse_rejects_foreign_app_field() {
        let json = serde_json::json!({
            "app": "chrome-bookmarks",
            "schema": 1,
            "exportedAt": 1,
            "folders": [],
            "bookmarks": [],
            "images": []
        })
        .to_string();
        let err = parse(json.as_bytes()).unwrap_err();
        assert_eq!(err, BackupError::NotTroveBackup);
    }

    #[test]
    fn parse_rejects_newer_schema_with_dedicated_error() {
        let json = serde_json::json!({
            "app": "trove",
            "schema": SCHEMA_VERSION + 1,
            "exportedAt": 1,
            "folders": [],
            "bookmarks": [],
            "images": []
        })
        .to_string();
        let err = parse(json.as_bytes()).unwrap_err();
        assert_eq!(err, BackupError::NewerSchema { found: SCHEMA_VERSION + 1, supported: SCHEMA_VERSION });
    }

    #[test]
    fn parse_rejects_broken_list_structure_on_current_schema() {
        let json = serde_json::json!({
            "app": "trove",
            "schema": SCHEMA_VERSION,
            "exportedAt": 1,
            "folders": "not-a-list",
            "bookmarks": [],
            "images": []
        })
        .to_string();
        let err = parse(json.as_bytes()).unwrap_err();
        assert_eq!(err, BackupError::NotTroveBackup);
    }

    #[test]
    fn parse_rejects_path_traversal_image_filename() {
        let json = serde_json::json!({
            "app": "trove",
            "schema": 1,
            "exportedAt": 1,
            "folders": [],
            "bookmarks": [],
            "images": [{ "filename": "../../evil.png", "data": "AAAA" }]
        })
        .to_string();
        let err = parse(json.as_bytes()).unwrap_err();
        assert!(matches!(err, BackupError::BrokenImage(_)));
    }

    #[test]
    fn parse_rejects_image_that_does_not_base64_decode() {
        let json = serde_json::json!({
            "app": "trove",
            "schema": 1,
            "exportedAt": 1,
            "folders": [],
            "bookmarks": [],
            "images": [{ "filename": "abc.png", "data": "not-valid-base64!!" }]
        })
        .to_string();
        let err = parse(json.as_bytes()).unwrap_err();
        assert!(matches!(err, BackupError::BrokenImage(_)));
    }

    #[test]
    fn parse_rejects_image_content_that_is_not_a_picture() {
        let data = STANDARD.encode(b"just plain text, not an image");
        let json = serde_json::json!({
            "app": "trove",
            "schema": 1,
            "exportedAt": 1,
            "folders": [],
            "bookmarks": [],
            "images": [{ "filename": "abc.png", "data": data }]
        })
        .to_string();
        let err = parse(json.as_bytes()).unwrap_err();
        assert!(matches!(err, BackupError::BrokenImage(_)));
    }

    #[test]
    fn parse_rejects_file_over_size_limit_without_reading_into_memory() {
        let json = valid_backup_json();
        let err = parse_within(json.as_bytes(), 4, MAX_IMAGE_DECODED_BYTES).unwrap_err();
        assert_eq!(err, BackupError::TooLarge);
    }

    #[test]
    fn parse_rejects_single_image_over_size_limit() {
        let bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        let data = STANDARD.encode(&bytes);
        let json = serde_json::json!({
            "app": "trove",
            "schema": 1,
            "exportedAt": 1,
            "folders": [],
            "bookmarks": [],
            "images": [{ "filename": "big.png", "data": data }]
        })
        .to_string();
        let err = parse_within(json.as_bytes(), MAX_BACKUP_BYTES, 4).unwrap_err();
        assert_eq!(err, BackupError::TooLarge);
    }

    #[test]
    fn parse_accepts_valid_file_and_summary_reports_counts() {
        let conn = setup();
        let folder_id = folders::create(&conn, "A", None).unwrap();
        let parsed = url_norm::parse("https://example.test/summary").unwrap();
        bookmarks::create(&conn, Some(folder_id), "One", &parsed, None, None).unwrap();
        let images_dir = scratch_images_dir("summary");
        let backup = build(&conn, &images_dir).unwrap();
        let json = serde_json::to_vec(&backup).unwrap();

        let reparsed = parse(&json).unwrap();
        let s = summary(&reparsed);
        assert_eq!(s.folders, 1);
        assert_eq!(s.bookmarks, 1);
        assert_eq!(s.exported_at, backup.exported_at);
    }

    #[test]
    fn parse_never_takes_a_database_connection_by_construction() {
        let err = parse(b"{}").unwrap_err();
        assert_eq!(err, BackupError::NotTroveBackup);
    }

    fn bf(id: i64, parent_id: Option<i64>, name: &str) -> BackupFolder {
        BackupFolder {
            id,
            parent_id,
            name: name.to_string(),
            description: None,
            image: None,
            sort: 0,
            sort_key: None,
            sort_dir: None,
            created_at: 1,
            updated_at: 1,
            tags: Vec::new(),
        }
    }

    fn bb(id: i64, folder_id: Option<i64>, title: &str, url: &str) -> BackupBookmark {
        BackupBookmark {
            id,
            folder_id,
            title: title.to_string(),
            url: url.to_string(),
            description: None,
            image: None,
            sort: 0,
            target_browser: None,
            target_profile: None,
            target_profile_name: None,
            created_at: 1,
            updated_at: 1,
            tags: Vec::new(),
        }
    }

    fn empty_backup() -> Backup {
        Backup {
            app: "trove".to_string(),
            schema: SCHEMA_VERSION,
            exported_at: 1,
            folders: Vec::new(),
            bookmarks: Vec::new(),
            images: Vec::new(),
        }
    }

    #[test]
    fn apply_replace_on_nonempty_db_leaves_exactly_file_content() {
        let mut conn = setup();
        folders::create(&conn, "Old", None).unwrap();
        let old_parsed = url_norm::parse("https://example.test/old").unwrap();
        bookmarks::create(&conn, None, "Old bm", &old_parsed, None, None).unwrap();

        let mut backup = empty_backup();
        backup.folders.push(bf(1, None, "New"));

        let images_dir = scratch_images_dir("replace-wipe");
        let applied = apply(&mut conn, &backup, ImportMode::Replace, &images_dir).unwrap();
        assert_eq!(applied.folders, 1);
        assert_eq!(applied.bookmarks, 0);

        let folder_names: Vec<String> =
            folders::list_all(&conn).unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(folder_names, vec!["New".to_string()]);
        let bookmark_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0)).unwrap();
        assert_eq!(bookmark_count, 0);
    }

    #[test]
    fn apply_merge_on_nonempty_db_keeps_existing_and_adds_missing() {
        let mut conn = setup();
        let existing_folder = folders::create(&conn, "Existing", None).unwrap();
        let existing_parsed = url_norm::parse("https://example.test/existing").unwrap();
        bookmarks::create(&conn, Some(existing_folder), "Existing bm", &existing_parsed, None, None).unwrap();

        let mut backup = empty_backup();
        backup.folders.push(bf(1, None, "New"));
        backup.bookmarks.push(bb(1, Some(1), "New bm", "https://example.test/new"));

        let images_dir = scratch_images_dir("merge-add");
        apply(&mut conn, &backup, ImportMode::Merge, &images_dir).unwrap();

        let folder_names: Vec<String> =
            folders::list_all(&conn).unwrap().into_iter().map(|f| f.name).collect();
        assert!(folder_names.contains(&"Existing".to_string()));
        assert!(folder_names.contains(&"New".to_string()));
        let bookmark_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0)).unwrap();
        assert_eq!(bookmark_count, 2);
    }

    #[test]
    fn apply_merge_updates_matched_bookmark_and_keeps_its_id() {
        let mut conn = setup();
        let parsed = url_norm::parse("https://example.test/match").unwrap();
        let existing_id =
            bookmarks::create(&conn, None, "Old title", &parsed, Some("old desc"), None).unwrap();

        let mut backup = empty_backup();
        let mut incoming = bb(1, None, "New title", "https://example.test/match");
        incoming.description = Some("new desc".to_string());
        incoming.tags = vec!["ui".to_string()];
        backup.bookmarks.push(incoming);

        let images_dir = scratch_images_dir("merge-update");
        let applied = apply(&mut conn, &backup, ImportMode::Merge, &images_dir).unwrap();
        assert_eq!(applied.bookmarks, 1);

        let (id_after, title, description): (i64, String, Option<String>) = conn
            .query_row(
                "SELECT id, title, description FROM bookmarks WHERE url_normalized = ?1",
                params![parsed.normalized],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(id_after, existing_id);
        assert_eq!(title, "New title");
        assert_eq!(description.as_deref(), Some("new desc"));
        let tags_after = tags::for_bookmark(&conn, existing_id).unwrap();
        assert_eq!(tags_after, vec!["ui".to_string()]);
    }

    #[test]
    fn apply_merge_matches_urls_that_normalize_the_same_even_when_written_differently() {
        let mut conn = setup();
        let existing_parsed = url_norm::parse("https://www.example.com/a/?utm_source=x").unwrap();
        bookmarks::create(&conn, None, "Existing", &existing_parsed, None, None).unwrap();

        let mut backup = empty_backup();
        backup.bookmarks.push(bb(1, None, "From file", "https://example.com/a"));

        let images_dir = scratch_images_dir("merge-normalized-match");
        let applied = apply(&mut conn, &backup, ImportMode::Merge, &images_dir).unwrap();
        assert_eq!(applied.bookmarks, 1);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
        let title: String = conn.query_row("SELECT title FROM bookmarks", [], |row| row.get(0)).unwrap();
        assert_eq!(title, "From file");
    }

    #[test]
    fn apply_restores_folder_hierarchy_and_recomputes_path() {
        let mut conn = setup();
        let mut backup = empty_backup();
        backup.folders.push(bf(1, None, "Root"));
        backup.folders.push(bf(2, Some(1), "Child"));

        let images_dir = scratch_images_dir("hierarchy");
        apply(&mut conn, &backup, ImportMode::Replace, &images_dir).unwrap();

        let (root_id, root_path): (i64, String) = conn
            .query_row("SELECT id, path FROM folders WHERE name = 'Root'", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        let (child_parent, child_path): (Option<i64>, String) = conn
            .query_row("SELECT parent_id, path FROM folders WHERE name = 'Child'", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(child_parent, Some(root_id));
        assert!(child_path.starts_with(&root_path));
        assert_ne!(child_path, root_path);
    }

    #[test]
    fn apply_writes_manual_images_to_disk_and_references_them() {
        let mut conn = setup();
        let png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        let filename = "deadbeef.png".to_string();

        let mut backup = empty_backup();
        let mut folder = bf(1, None, "With image");
        folder.image = Some(filename.clone());
        backup.folders.push(folder);
        backup.images.push(BackupImage { filename: filename.clone(), data: STANDARD.encode(&png) });

        let images_dir = scratch_images_dir("apply-images");
        apply(&mut conn, &backup, ImportMode::Replace, &images_dir).unwrap();

        let written = std::fs::read(images_dir.join(&filename)).unwrap();
        assert_eq!(written, png);
        let stored_image: Option<String> = conn
            .query_row("SELECT image FROM folders WHERE name = 'With image'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored_image, Some(filename));
    }

    #[test]
    fn apply_failure_midway_leaves_no_trace() {
        let mut conn = setup();
        let pre_folder = folders::create(&conn, "Pre", None).unwrap();
        let pre_parsed = url_norm::parse("https://example.test/pre").unwrap();
        bookmarks::create(&conn, Some(pre_folder), "Pre bm", &pre_parsed, None, None).unwrap();

        let folders_before: i64 =
            conn.query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0)).unwrap();
        let bookmarks_before: i64 =
            conn.query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0)).unwrap();

        let mut backup = empty_backup();
        backup.folders.push(bf(1, None, "Good folder"));
        backup.bookmarks.push(bb(1, Some(1), "Good bm", "https://example.test/good"));
        backup.bookmarks.push(bb(2, Some(999), "Broken bm", "https://example.test/broken"));

        let images_dir = scratch_images_dir("rollback");
        let err = apply(&mut conn, &backup, ImportMode::Merge, &images_dir).unwrap_err();
        assert!(matches!(err, BackupError::BrokenReference(_)));

        let folders_after: i64 =
            conn.query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0)).unwrap();
        let bookmarks_after: i64 =
            conn.query_row("SELECT COUNT(*) FROM bookmarks", [], |row| row.get(0)).unwrap();
        assert_eq!(folders_after, folders_before);
        assert_eq!(bookmarks_after, bookmarks_before);
    }

    #[test]
    fn apply_to_empty_db_gives_same_result_in_both_modes() {
        let mut conn_replace = setup();
        let mut conn_merge = setup();

        let mut backup = empty_backup();
        backup.folders.push(bf(1, None, "A"));
        backup.bookmarks.push(bb(1, Some(1), "Bm", "https://example.test/same"));

        let dir_replace = scratch_images_dir("empty-replace");
        let dir_merge = scratch_images_dir("empty-merge");

        let applied_replace = apply(&mut conn_replace, &backup, ImportMode::Replace, &dir_replace).unwrap();
        let applied_merge = apply(&mut conn_merge, &backup, ImportMode::Merge, &dir_merge).unwrap();

        assert_eq!(applied_replace, applied_merge);
        let names_replace: Vec<String> =
            folders::list_all(&conn_replace).unwrap().into_iter().map(|f| f.name).collect();
        let names_merge: Vec<String> =
            folders::list_all(&conn_merge).unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names_replace, names_merge);
    }

    #[test]
    fn apply_treats_sql_special_characters_in_names_and_tags_as_plain_text() {
        let mut conn = setup();
        let hostile_name = "Robert'); DROP TABLE folders;--".to_string();
        let hostile_tag = "ui'; DELETE FROM tags; --".to_string();

        let mut backup = empty_backup();
        let mut folder = bf(1, None, &hostile_name);
        folder.tags = vec![hostile_tag.clone()];
        backup.folders.push(folder);
        let mut bookmark = bb(1, Some(1), &hostile_name, "https://example.test/injection");
        bookmark.tags = vec![hostile_tag.clone()];
        backup.bookmarks.push(bookmark);

        let images_dir = scratch_images_dir("sql-safety");
        let applied = apply(&mut conn, &backup, ImportMode::Replace, &images_dir).unwrap();
        assert_eq!(applied.folders, 1);
        assert_eq!(applied.bookmarks, 1);

        let folder_name: String =
            conn.query_row("SELECT name FROM folders", [], |row| row.get(0)).unwrap();
        assert_eq!(folder_name, hostile_name);
        let bookmark_title: String =
            conn.query_row("SELECT title FROM bookmarks", [], |row| row.get(0)).unwrap();
        assert_eq!(bookmark_title, hostile_name);
        let tag_names = tags::list_all(&conn).unwrap();
        assert_eq!(tag_names, vec![hostile_tag]);
    }

    #[test]
    fn round_trip_source_db_to_json_to_empty_db_to_matching_db() {
        let mut source = setup();
        let root = folders::create(&source, "Работа", None).unwrap();
        let child = folders::create(&source, "Проекты", Some(root)).unwrap();
        tags::set_for_folder(&mut source, child, &["важное".to_string()]).unwrap();
        let parsed = url_norm::parse("https://example.test/roundtrip").unwrap();
        let bm = bookmarks::create(&source, Some(child), "Круговой рейс", &parsed, Some("описание"), None).unwrap();
        tags::set_for_bookmark(&mut source, bm, &["ui".to_string(), "работа".to_string()]).unwrap();

        let source_images_dir = scratch_images_dir("roundtrip-source");
        let exported = build(&source, &source_images_dir).unwrap();
        let json = serde_json::to_vec(&exported).unwrap();

        let mut target = setup();
        let target_images_dir = scratch_images_dir("roundtrip-target");
        let reparsed = parse(&json).unwrap();
        apply(&mut target, &reparsed, ImportMode::Replace, &target_images_dir).unwrap();

        let reexported = build(&target, &target_images_dir).unwrap();

        let source_folder_names: Vec<String> =
            exported.folders.iter().map(|f| f.name.clone()).collect();
        let target_folder_names: Vec<String> =
            reexported.folders.iter().map(|f| f.name.clone()).collect();
        assert_eq!(source_folder_names, target_folder_names);

        let source_folder_parent_names: Vec<Option<String>> = exported
            .folders
            .iter()
            .map(|f| f.parent_id.and_then(|pid| exported.folders.iter().find(|p| p.id == pid)).map(|p| p.name.clone()))
            .collect();
        let target_folder_parent_names: Vec<Option<String>> = reexported
            .folders
            .iter()
            .map(|f| f.parent_id.and_then(|pid| reexported.folders.iter().find(|p| p.id == pid)).map(|p| p.name.clone()))
            .collect();
        assert_eq!(source_folder_parent_names, target_folder_parent_names);

        assert_eq!(exported.bookmarks.len(), reexported.bookmarks.len());
        let source_bm = &exported.bookmarks[0];
        let target_bm = &reexported.bookmarks[0];
        assert_eq!(source_bm.title, target_bm.title);
        assert_eq!(source_bm.url, target_bm.url);
        assert_eq!(source_bm.description, target_bm.description);
        assert_eq!(source_bm.tags, target_bm.tags);
    }
}
