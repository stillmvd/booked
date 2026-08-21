use rusqlite::{params, params_from_iter, Connection};
use std::path::Path;
use std::fs;

use sha2::{Digest, Sha256};

pub const MAX_HTML_BYTES: usize = 512 * 1024;
pub const MIN_IMAGE_BYTES: usize = 1024;
pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
pub const REDIRECT_LIMIT: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewOrigin {
    Og,
    Twitter,
    AppleTouch,
    Favicon,
    HostRule,
}

impl PreviewOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            PreviewOrigin::Og => "og",
            PreviewOrigin::Twitter => "twitter",
            PreviewOrigin::AppleTouch => "apple-touch",
            PreviewOrigin::Favicon => "favicon",
            PreviewOrigin::HostRule => "host-rule",
        }
    }
}

impl std::str::FromStr for PreviewOrigin {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "og" => Ok(PreviewOrigin::Og),
            "twitter" => Ok(PreviewOrigin::Twitter),
            "apple-touch" => Ok(PreviewOrigin::AppleTouch),
            "favicon" => Ok(PreviewOrigin::Favicon),
            "host-rule" => Ok(PreviewOrigin::HostRule),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectReason {
    BadStatus,
    BadContentType,
    UnknownFormat,
    TooSmall,
    TooLarge,
}

fn sniff_ico_or_svg(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("ico");
    }
    let mut trimmed = bytes;
    if trimmed.starts_with(&[0xEF, 0xBB, 0xBF]) {
        trimmed = &trimmed[3..];
    }
    while trimmed.first().is_some_and(|b| b.is_ascii_whitespace()) {
        trimmed = &trimmed[1..];
    }
    if trimmed.starts_with(b"<?xml") || trimmed.starts_with(b"<svg") {
        return Some("svg");
    }
    None
}

pub fn sniff_image_ext(bytes: &[u8]) -> Option<&'static str> {
    crate::images::detect_extension(bytes).or_else(|| sniff_ico_or_svg(bytes))
}

pub fn accept_image(
    status_ok: bool,
    content_type: &str,
    bytes: &[u8],
) -> Result<&'static str, RejectReason> {
    if !status_ok {
        return Err(RejectReason::BadStatus);
    }
    if !content_type.starts_with("image/") {
        return Err(RejectReason::BadContentType);
    }
    let ext = sniff_image_ext(bytes).ok_or(RejectReason::UnknownFormat)?;
    if bytes.len() < MIN_IMAGE_BYTES {
        return Err(RejectReason::TooSmall);
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(RejectReason::TooLarge);
    }
    Ok(ext)
}

pub fn preview_key(normalized_url: &str) -> String {
    let hash = Sha256::digest(normalized_url.as_bytes());
    hash.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

pub fn preview_rel_path(file: &str) -> String {
    let prefix = &file[..2.min(file.len())];
    format!("previews/{prefix}/{file}")
}

pub fn write_preview(
    previews_dir: &Path,
    key: &str,
    ext: &str,
    bytes: &[u8],
) -> std::io::Result<String> {
    let prefix = &key[..2.min(key.len())];
    let subdir = previews_dir.join(prefix);
    fs::create_dir_all(&subdir)?;
    let filename = format!("{key}.{ext}");
    let dest = subdir.join(&filename);
    if !dest.exists() {
        fs::write(&dest, bytes)?;
    }
    Ok(filename)
}

pub fn set_auto_preview(
    conn: &Connection,
    id: i64,
    file: &str,
    origin: PreviewOrigin,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE bookmarks SET preview_file = ?1, preview_origin = ?2, preview_fetched_at = unixepoch() \
         WHERE id = ?3",
        params![file, origin.as_str(), id],
    )?;
    Ok(())
}

pub fn set_user_image(conn: &Connection, id: i64, filename: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE bookmarks SET image = ?1 WHERE id = ?2", params![filename, id])?;
    Ok(())
}

pub fn clear_user_image(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE bookmarks SET image = NULL WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn due_for_preview(
    conn: &Connection,
    ids: &[i64],
    force: bool,
) -> rusqlite::Result<Vec<(i64, String, String)>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
    let sql = if force {
        format!(
            "SELECT id, url, url_normalized FROM bookmarks WHERE id IN ({})",
            placeholders.join(",")
        )
    } else {
        format!(
            "SELECT id, url, url_normalized FROM bookmarks WHERE id IN ({}) AND preview_fetched_at IS NULL",
            placeholders.join(",")
        )
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids.iter()), |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    rows.collect()
}

pub fn set_auto_preview_batch(
    conn: &mut Connection,
    results: &[(i64, Option<String>, Option<PreviewOrigin>)],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for (id, file, origin) in results {
        if let (Some(file), Some(origin)) = (file, origin) {
            tx.execute(
                "UPDATE bookmarks SET preview_file = ?1, preview_origin = ?2, preview_fetched_at = unixepoch() \
                 WHERE id = ?3",
                params![file, origin.as_str(), id],
            )?;
        } else {
            tx.execute(
                "UPDATE bookmarks SET preview_fetched_at = unixepoch() WHERE id = ?1",
                params![id],
            )?;
        }
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::url_norm;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn insert_bookmark(conn: &Connection, url: &str) -> i64 {
        let parsed = url_norm::parse(url).unwrap();
        conn.execute(
            "INSERT INTO bookmarks (folder_id, title, url, url_normalized) VALUES (NULL, ?1, ?2, ?3)",
            params!["T", parsed.url, parsed.normalized],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn preview_key_is_deterministic() {
        let a = preview_key("https://example.test/a");
        let b = preview_key("https://example.test/a");
        assert_eq!(a, b);
    }

    #[test]
    fn preview_key_differs_by_url() {
        let a = preview_key("https://example.test/a");
        let b = preview_key("https://example.test/b");
        assert_ne!(a, b);
    }

    #[test]
    fn preview_rel_path_fans_out_by_first_two_chars() {
        let path = preview_rel_path("abcd1234.jpg");
        assert_eq!(path, "previews/ab/abcd1234.jpg");
    }

    #[test]
    fn sniff_image_ext_recognizes_six_formats() {
        assert_eq!(
            sniff_image_ext(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            Some("png")
        );
        assert_eq!(sniff_image_ext(&[0xFF, 0xD8, 0xFF]), Some("jpg"));
        assert_eq!(sniff_image_ext(b"GIF89a"), Some("gif"));
        let mut webp = b"RIFF".to_vec();
        webp.extend_from_slice(&[0, 0, 0, 0]);
        webp.extend_from_slice(b"WEBP");
        assert_eq!(sniff_image_ext(&webp), Some("webp"));
        assert_eq!(sniff_image_ext(&[0x00, 0x00, 0x01, 0x00, 0xFF]), Some("ico"));
        assert_eq!(
            sniff_image_ext(b"<?xml version=\"1.0\"?><svg></svg>"),
            Some("svg")
        );
    }

    #[test]
    fn sniff_image_ext_rejects_html() {
        assert_eq!(sniff_image_ext(b"<!DOCTYPE html><html></html>"), None);
    }

    #[test]
    fn accept_image_rejects_bad_status_even_if_body_decodes() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
            .iter()
            .chain(std::iter::repeat(&0u8).take(MIN_IMAGE_BYTES))
            .copied()
            .collect::<Vec<u8>>();
        let err = accept_image(false, "image/png", &png).unwrap_err();
        assert_eq!(err, RejectReason::BadStatus);
    }

    #[test]
    fn accept_image_rejects_non_image_content_type() {
        let err = accept_image(true, "text/html", b"whatever").unwrap_err();
        assert_eq!(err, RejectReason::BadContentType);
    }

    #[test]
    fn accept_image_rejects_body_shorter_than_1kib() {
        let png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let err = accept_image(true, "image/png", &png).unwrap_err();
        assert_eq!(err, RejectReason::TooSmall);
    }

    #[test]
    fn accept_image_rejects_body_longer_than_2mib() {
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend(std::iter::repeat(0u8).take(MAX_IMAGE_BYTES + 1));
        let err = accept_image(true, "image/png", &png).unwrap_err();
        assert_eq!(err, RejectReason::TooLarge);
    }

    #[test]
    fn accept_image_accepts_valid_image_and_returns_extension() {
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend(std::iter::repeat(0u8).take(MIN_IMAGE_BYTES));
        let ext = accept_image(true, "image/png", &png).unwrap();
        assert_eq!(ext, "png");
    }

    #[test]
    fn set_auto_preview_writes_file_origin_and_timestamp() {
        let conn = setup();
        let id = insert_bookmark(&conn, "https://example.test/a");

        set_auto_preview(&conn, id, "abcd1234.jpg", PreviewOrigin::Og).unwrap();

        let (file, origin, fetched_at): (Option<String>, Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT preview_file, preview_origin, preview_fetched_at FROM bookmarks WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(file.as_deref(), Some("abcd1234.jpg"));
        assert_eq!(origin.as_deref(), Some("og"));
        assert!(fetched_at.is_some());
    }

    #[test]
    fn set_auto_preview_never_touches_manual_image_column() {
        let conn = setup();
        let id = insert_bookmark(&conn, "https://example.test/b");
        conn.execute(
            "UPDATE bookmarks SET image = ?1 WHERE id = ?2",
            params!["manual.png", id],
        )
        .unwrap();

        set_auto_preview(&conn, id, "auto.jpg", PreviewOrigin::Og).unwrap();

        let image: Option<String> = conn
            .query_row("SELECT image FROM bookmarks WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(image.as_deref(), Some("manual.png"));
    }

    #[test]
    fn set_auto_preview_on_missing_id_touches_zero_rows_and_is_not_an_error() {
        let conn = setup();
        set_auto_preview(&conn, 999_999, "ghost.jpg", PreviewOrigin::Og).unwrap();
    }

    #[test]
    fn set_user_image_writes_image_without_touching_preview_columns() {
        let conn = setup();
        let id = insert_bookmark(&conn, "https://example.test/c");
        set_auto_preview(&conn, id, "auto.jpg", PreviewOrigin::Og).unwrap();

        set_user_image(&conn, id, "manual.png").unwrap();

        let (image, preview_file): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT image, preview_file FROM bookmarks WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(image.as_deref(), Some("manual.png"));
        assert_eq!(preview_file.as_deref(), Some("auto.jpg"));
    }

    #[test]
    fn clear_user_image_sets_image_null_without_touching_preview_file() {
        let conn = setup();
        let id = insert_bookmark(&conn, "https://example.test/d");
        set_auto_preview(&conn, id, "auto.jpg", PreviewOrigin::Og).unwrap();
        set_user_image(&conn, id, "manual.png").unwrap();

        clear_user_image(&conn, id).unwrap();

        let (image, preview_file): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT image, preview_file FROM bookmarks WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(image, None);
        assert_eq!(preview_file.as_deref(), Some("auto.jpg"));
    }

    #[test]
    fn clear_user_image_on_missing_id_touches_zero_rows_and_is_not_an_error() {
        let conn = setup();
        clear_user_image(&conn, 999_999).unwrap();
    }

    #[test]
    fn due_for_preview_returns_only_unfetched_rows() {
        let conn = setup();
        let fetched = insert_bookmark(&conn, "https://example.test/fetched");
        let pending = insert_bookmark(&conn, "https://example.test/pending");
        set_auto_preview(&conn, fetched, "done.jpg", PreviewOrigin::Og).unwrap();

        let due = due_for_preview(&conn, &[fetched, pending], false).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0, pending);
    }

    #[test]
    fn due_for_preview_force_includes_already_fetched_rows() {
        let conn = setup();
        let fetched = insert_bookmark(&conn, "https://example.test/force-fetched");
        set_auto_preview(&conn, fetched, "done.jpg", PreviewOrigin::Og).unwrap();

        let normal = due_for_preview(&conn, &[fetched], false).unwrap();
        assert_eq!(normal.len(), 0);

        let forced = due_for_preview(&conn, &[fetched], true).unwrap();
        assert_eq!(forced.len(), 1);
        assert_eq!(forced[0].0, fetched);
    }

    #[test]
    fn set_auto_preview_batch_writes_success_and_failure_in_one_transaction() {
        let mut conn = setup();
        let ok_id = insert_bookmark(&conn, "https://example.test/batch-ok");
        let fail_id = insert_bookmark(&conn, "https://example.test/batch-fail");

        set_auto_preview_batch(
            &mut conn,
            &[
                (ok_id, Some("ok.jpg".to_string()), Some(PreviewOrigin::Og)),
                (fail_id, None, None),
            ],
        )
        .unwrap();

        let (ok_file, ok_fetched): (Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT preview_file, preview_fetched_at FROM bookmarks WHERE id = ?1",
                params![ok_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(ok_file.as_deref(), Some("ok.jpg"));
        assert!(ok_fetched.is_some());

        let (fail_file, fail_fetched): (Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT preview_file, preview_fetched_at FROM bookmarks WHERE id = ?1",
                params![fail_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(fail_file, None);
        assert!(fail_fetched.is_some());
    }

    #[test]
    fn set_auto_preview_batch_on_failure_does_not_clear_existing_file() {
        let mut conn = setup();
        let id = insert_bookmark(&conn, "https://example.test/retry-fail");
        set_auto_preview(&conn, id, "stale.jpg", PreviewOrigin::Og).unwrap();

        set_auto_preview_batch(&mut conn, &[(id, None, None)]).unwrap();

        let file: Option<String> = conn
            .query_row("SELECT preview_file FROM bookmarks WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(file.as_deref(), Some("stale.jpg"));
    }
}
