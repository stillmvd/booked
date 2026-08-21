use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use trove_core::preview::{self, PreviewOrigin};

use crate::db::{with_conn, Db};
use crate::net::{self, Fetcher};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInfo {
    pub file: String,
    pub origin: String,
}

fn attr_value(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{attr}=");
    let pos = lower.find(&needle)?;
    let after = &tag[pos + needle.len()..];
    let quote = after.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &after[quote.len_utf8()..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn find_og_image(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut idx = 0;
    while let Some(rel) = lower[idx..].find("<meta") {
        let start = idx + rel;
        let Some(end_rel) = lower[start..].find('>') else {
            break;
        };
        let tag_end = start + end_rel + 1;
        let tag = &html[start..tag_end];
        let prop = attr_value(tag, "property").or_else(|| attr_value(tag, "name"));
        if prop.as_deref().is_some_and(|p| p.eq_ignore_ascii_case("og:image")) {
            if let Some(content) = attr_value(tag, "content") {
                return Some(content);
            }
        }
        idx = tag_end;
    }
    None
}

#[tauri::command]
pub async fn preview_fetch(
    app: AppHandle,
    db: State<'_, Db>,
    fetcher: State<'_, Fetcher>,
    id: i64,
) -> Result<PreviewInfo, String> {
    let (url, url_normalized) = with_conn(&db, |conn| {
        conn.query_row(
            "SELECT url, url_normalized FROM bookmarks WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
    })?;

    let page = net::fetch_page(&fetcher.client, &url).await.map_err(|e| e.to_string())?;
    let html = String::from_utf8_lossy(&page.body);
    let raw_image = find_og_image(&html).ok_or("og:image не найден на странице")?;

    let base = url::Url::parse(&page.final_url).map_err(|e| e.to_string())?;
    let image_url = base.join(&raw_image).map_err(|e| e.to_string())?;
    if !matches!(image_url.scheme(), "http" | "https") {
        return Err("недопустимая схема адреса картинки".into());
    }

    let image = net::fetch_image(&fetcher.client, image_url.as_str())
        .await
        .map_err(|e| e.to_string())?;
    let ext = preview::accept_image(image.status_ok, &image.content_type, &image.bytes)
        .map_err(|e| format!("{e:?}"))?;

    let previews_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("previews");
    let key = preview::preview_key(&url_normalized);
    let filename =
        preview::write_preview(&previews_dir, &key, ext, &image.bytes).map_err(|e| e.to_string())?;

    with_conn(&db, |conn| preview::set_auto_preview(conn, id, &filename, PreviewOrigin::Og))?;

    Ok(PreviewInfo {
        file: filename,
        origin: PreviewOrigin::Og.as_str().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_og_image_reads_content_after_property() {
        let html = r#"<head><meta property="og:image" content="https://example.test/a.jpg"></head>"#;
        assert_eq!(find_og_image(html).as_deref(), Some("https://example.test/a.jpg"));
    }

    #[test]
    fn find_og_image_reads_content_before_property() {
        let html = r#"<meta content="https://example.test/b.jpg" property="og:image">"#;
        assert_eq!(find_og_image(html).as_deref(), Some("https://example.test/b.jpg"));
    }

    #[test]
    fn find_og_image_accepts_single_quotes() {
        let html = r#"<meta property='og:image' content='https://example.test/c.jpg'>"#;
        assert_eq!(find_og_image(html).as_deref(), Some("https://example.test/c.jpg"));
    }

    #[test]
    fn find_og_image_returns_none_without_tag() {
        let html = "<head><title>No preview here</title></head>";
        assert_eq!(find_og_image(html), None);
    }

    #[test]
    fn find_og_image_skips_unrelated_meta_tags() {
        let html = r#"<meta name="description" content="not this one"><meta property="og:image" content="https://example.test/d.jpg">"#;
        assert_eq!(find_og_image(html).as_deref(), Some("https://example.test/d.jpg"));
    }

    #[test]
    #[ignore]
    fn tracer_slice_downloads_real_og_image_to_disk() {
        let dir = std::env::temp_dir().join(format!("trove-tracer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let client = net::build_client();
        let url = "https://github.com/tauri-apps/tauri";

        let (filename, ext) = tauri::async_runtime::block_on(async {
            let page = net::fetch_page(&client, url).await.expect("fetch_page failed");
            let html = String::from_utf8_lossy(&page.body);
            let raw_image = find_og_image(&html).expect("no og:image found on live page");
            let base = url::Url::parse(&page.final_url).unwrap();
            let image_url = base.join(&raw_image).unwrap();
            assert!(matches!(image_url.scheme(), "http" | "https"));

            let image = net::fetch_image(&client, image_url.as_str())
                .await
                .expect("fetch_image failed");
            let ext = preview::accept_image(image.status_ok, &image.content_type, &image.bytes)
                .expect("accept_image rejected a real og:image");
            let key = preview::preview_key("https://github.com/tauri-apps/tauri");
            let filename = preview::write_preview(&dir, &key, ext, &image.bytes).unwrap();
            (filename, ext.to_string())
        });

        let full = dir.join(&filename[..2]).join(&filename);
        assert!(full.exists(), "preview file missing on disk at {full:?}");
        assert!(filename.ends_with(&format!(".{ext}")));
        assert!(!filename.to_ascii_lowercase().contains("tauri-apps"));
        assert!(!filename.to_ascii_lowercase().contains("github"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
