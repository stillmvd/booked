use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use url::Url;

use crate::preview::sniff_image_ext;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaviconStatus {
    Found,
    Absent,
    Failed,
}

impl FaviconStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            FaviconStatus::Found => "found",
            FaviconStatus::Absent => "absent",
            FaviconStatus::Failed => "failed",
        }
    }
}

impl std::str::FromStr for FaviconStatus {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "found" => Ok(FaviconStatus::Found),
            "absent" => Ok(FaviconStatus::Absent),
            "failed" => Ok(FaviconStatus::Failed),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FaviconRow {
    pub host: String,
    pub file: Option<String>,
    pub status: FaviconStatus,
    pub fetched_at: i64,
}

pub fn icon_key(host: &str) -> String {
    let hash = Sha256::digest(host.as_bytes());
    hash.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

pub fn guess_urls(url: &Url) -> [Url; 2] {
    let apple = url.join("/apple-touch-icon.png").unwrap_or_else(|_| url.clone());
    let favicon = url.join("/favicon.ico").unwrap_or_else(|_| url.clone());
    [apple, favicon]
}

pub fn cached(conn: &Connection, host: &str) -> rusqlite::Result<Option<FaviconRow>> {
    conn.query_row(
        "SELECT host, file, status, fetched_at FROM favicons WHERE host = ?1",
        params![host],
        |row| {
            let status_str: String = row.get(2)?;
            let status = status_str.parse::<FaviconStatus>().unwrap_or(FaviconStatus::Failed);
            Ok(FaviconRow {
                host: row.get(0)?,
                file: row.get(1)?,
                status,
                fetched_at: row.get(3)?,
            })
        },
    )
    .optional()
}

pub fn record(
    conn: &Connection,
    host: &str,
    file: Option<&str>,
    status: FaviconStatus,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO favicons (host, file, status, fetched_at) VALUES (?1, ?2, ?3, unixepoch()) \
         ON CONFLICT(host) DO UPDATE SET file = excluded.file, status = excluded.status, fetched_at = excluded.fetched_at",
        params![host, file, status.as_str()],
    )?;
    Ok(())
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let cleaned: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    let mut chunk = [0u8; 4];
    let mut chunk_len = 0usize;

    for b in cleaned {
        if b == b'=' {
            break;
        }
        chunk[chunk_len] = val(b)?;
        chunk_len += 1;
        if chunk_len == 4 {
            out.push((chunk[0] << 2) | (chunk[1] >> 4));
            out.push((chunk[1] << 4) | (chunk[2] >> 2));
            out.push((chunk[2] << 6) | chunk[3]);
            chunk_len = 0;
        }
    }

    match chunk_len {
        0 => Some(out),
        2 => {
            out.push((chunk[0] << 2) | (chunk[1] >> 4));
            Some(out)
        }
        3 => {
            out.push((chunk[0] << 2) | (chunk[1] >> 4));
            out.push((chunk[1] << 4) | (chunk[2] >> 2));
            Some(out)
        }
        _ => None,
    }
}

pub fn decode_data_uri(data_uri: &str) -> Option<(Vec<u8>, String)> {
    let rest = data_uri.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    if !meta.split(';').any(|part| part.eq_ignore_ascii_case("base64")) {
        return None;
    }
    let bytes = base64_decode(data)?;
    let ext = sniff_image_ext(&bytes)?;
    Some((bytes, ext.to_string()))
}

pub fn write_icon(icons_dir: &Path, key: &str, ext: &str, bytes: &[u8]) -> std::io::Result<String> {
    fs::create_dir_all(icons_dir)?;
    let filename = format!("{key}.{ext}");
    let dest = icons_dir.join(&filename);
    if !dest.exists() {
        fs::write(&dest, bytes)?;
    }
    Ok(filename)
}

pub fn for_hosts(
    conn: &Connection,
    hosts: &[String],
) -> rusqlite::Result<std::collections::HashMap<String, String>> {
    if hosts.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let placeholders: Vec<String> = (1..=hosts.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT host, file FROM favicons WHERE host IN ({}) AND status = 'found' AND file IS NOT NULL",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(hosts.iter()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::preview;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trove-favicons-test-{}-{name}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn png_bytes(len: usize) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend(std::iter::repeat(0u8).take(len.saturating_sub(bytes.len())));
        bytes
    }

    fn ico_bytes(len: usize) -> Vec<u8> {
        let mut bytes = b"\x00\x00\x01\x00".to_vec();
        bytes.extend(std::iter::repeat(0u8).take(len.saturating_sub(bytes.len())));
        bytes
    }

    fn svg_bytes(len: usize) -> Vec<u8> {
        let mut bytes = b"<?xml version=\"1.0\"?><svg></svg>".to_vec();
        bytes.extend(std::iter::repeat(b' ').take(len.saturating_sub(bytes.len())));
        bytes
    }

    #[test]
    fn icon_key_is_deterministic() {
        let a = icon_key("example.test");
        let b = icon_key("example.test");
        assert_eq!(a, b);
    }

    #[test]
    fn icon_key_differs_by_host() {
        let a = icon_key("example.test");
        let b = icon_key("other.test");
        assert_ne!(a, b);
    }

    #[test]
    fn icon_key_does_not_contain_host_characters() {
        let host = "example.test";
        let key = icon_key(host);
        assert!(!key.contains("example"));
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn guess_urls_orders_apple_then_favicon() {
        let url = Url::parse("https://example.test/a/b/c").unwrap();
        let [apple, favicon] = guess_urls(&url);
        assert_eq!(apple.as_str(), "https://example.test/apple-touch-icon.png");
        assert_eq!(favicon.as_str(), "https://example.test/favicon.ico");
    }

    #[test]
    fn guess_urls_are_built_from_origin_not_path() {
        let url = Url::parse("https://example.test/a/b/c?x=1#y").unwrap();
        let [apple, favicon] = guess_urls(&url);
        assert!(!apple.path().contains("a/b/c"));
        assert!(!favicon.path().contains("a/b/c"));
        assert_eq!(apple.host_str(), Some("example.test"));
        assert_eq!(favicon.host_str(), Some("example.test"));
    }

    #[test]
    fn cached_returns_none_for_unknown_host() {
        let conn = setup();
        assert!(cached(&conn, "example.test").unwrap().is_none());
    }

    #[test]
    fn record_then_cached_round_trips_found_status() {
        let conn = setup();
        record(&conn, "example.test", Some("abcd1234.png"), FaviconStatus::Found).unwrap();
        let row = cached(&conn, "example.test").unwrap().unwrap();
        assert_eq!(row.file.as_deref(), Some("abcd1234.png"));
        assert_eq!(row.status, FaviconStatus::Found);
    }

    #[test]
    fn record_upserts_same_host_instead_of_duplicating() {
        let conn = setup();
        record(&conn, "example.test", None, FaviconStatus::Failed).unwrap();
        record(&conn, "example.test", Some("abcd1234.png"), FaviconStatus::Found).unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM favicons", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);

        let row = cached(&conn, "example.test").unwrap().unwrap();
        assert_eq!(row.status, FaviconStatus::Found);
        assert_eq!(row.file.as_deref(), Some("abcd1234.png"));
    }

    #[test]
    fn for_hosts_returns_only_found_status_with_a_file() {
        let conn = setup();
        record(&conn, "found.test", Some("f1.png"), FaviconStatus::Found).unwrap();
        record(&conn, "absent.test", None, FaviconStatus::Absent).unwrap();
        record(&conn, "failed.test", None, FaviconStatus::Failed).unwrap();

        let map = for_hosts(
            &conn,
            &[
                "found.test".to_string(),
                "absent.test".to_string(),
                "failed.test".to_string(),
                "unknown.test".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(map.len(), 1);
        assert_eq!(map.get("found.test").map(String::as_str), Some("f1.png"));
    }

    #[test]
    fn for_hosts_of_empty_list_is_empty_without_query() {
        let conn = setup();
        let map = for_hosts(&conn, &[]).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn record_distinguishes_absent_from_failed() {
        let conn = setup();
        record(&conn, "a.test", None, FaviconStatus::Absent).unwrap();
        record(&conn, "b.test", None, FaviconStatus::Failed).unwrap();

        assert_eq!(cached(&conn, "a.test").unwrap().unwrap().status, FaviconStatus::Absent);
        assert_eq!(cached(&conn, "b.test").unwrap().unwrap().status, FaviconStatus::Failed);
    }

    #[test]
    fn decode_data_uri_decodes_valid_base64_png() {
        let uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        let (bytes, ext) = decode_data_uri(uri).unwrap();
        assert_eq!(ext, "png");
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    }

    #[test]
    fn decode_data_uri_rejects_broken_base64() {
        let uri = "data:image/png;base64,not-valid-base64!!!";
        assert!(decode_data_uri(uri).is_none());
    }

    #[test]
    fn decode_data_uri_rejects_unknown_image_format() {
        let uri = "data:text/plain;base64,aGVsbG8gd29ybGQ=";
        assert!(decode_data_uri(uri).is_none());
    }

    #[test]
    fn write_icon_is_idempotent() {
        let dir = scratch_dir("write-icon-idempotent");
        let bytes = png_bytes(1024);

        let first = write_icon(&dir, "abcd1234", "png", &bytes).unwrap();
        let second = write_icon(&dir, "abcd1234", "png", &bytes).unwrap();
        assert_eq!(first, second);

        let entries: Vec<_> = fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn accept_image_rejects_404_stub_with_decodable_png_body() {
        let bytes = png_bytes(preview::MIN_IMAGE_BYTES);
        let err = preview::accept_image(false, "image/png", &bytes).unwrap_err();
        assert_eq!(err, preview::RejectReason::BadStatus);
    }

    #[test]
    fn accept_image_rejects_html_200_under_icon_name() {
        let mut html = b"<!DOCTYPE html><html><body>error</body></html>".to_vec();
        html.extend(std::iter::repeat(b' ').take(preview::MIN_IMAGE_BYTES.saturating_sub(html.len())));
        let err = preview::accept_image(true, "text/html", &html).unwrap_err();
        assert_eq!(err, preview::RejectReason::BadContentType);
    }

    #[test]
    fn accept_image_accepts_valid_ico_png_and_svg() {
        let ico = ico_bytes(preview::MIN_IMAGE_BYTES);
        assert_eq!(preview::accept_image(true, "image/x-icon", &ico).unwrap(), "ico");

        let png = png_bytes(preview::MIN_IMAGE_BYTES);
        assert_eq!(preview::accept_image(true, "image/png", &png).unwrap(), "png");

        let svg = svg_bytes(preview::MIN_IMAGE_BYTES);
        assert_eq!(preview::accept_image(true, "image/svg+xml", &svg).unwrap(), "svg");
    }
}
