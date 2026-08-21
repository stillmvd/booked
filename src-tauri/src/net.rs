use std::path::Path;
use std::time::Duration;

use trove_core::host_rules;
use trove_core::meta;
use trove_core::preview::{self, PreviewOrigin};

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                       (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

pub struct Fetcher {
    pub client: reqwest::Client,
}

pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(5))
        .connect_timeout(Duration::from_secs(5))
        .read_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .expect("reqwest client config is valid")
}

#[derive(Debug)]
pub enum FetchError {
    NotHtml,
    TooManyRedirects,
    BadScheme,
    Status(u16),
    Network(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::NotHtml => write!(f, "страница не является HTML"),
            FetchError::TooManyRedirects => write!(f, "слишком много перенаправлений"),
            FetchError::BadScheme => write!(f, "поддерживаются только http и https"),
            FetchError::Status(code) => write!(f, "сервер ответил кодом {code}"),
            FetchError::Network(message) => write!(f, "{message}"),
        }
    }
}

impl From<reqwest::Error> for FetchError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_redirect() {
            FetchError::TooManyRedirects
        } else {
            FetchError::Network(err.to_string())
        }
    }
}

fn is_http_scheme(url: &str) -> bool {
    url::Url::parse(url)
        .map(|parsed| matches!(parsed.scheme(), "http" | "https"))
        .unwrap_or(false)
}

pub struct FetchedPage {
    pub final_url: String,
    pub body: Vec<u8>,
    pub content_type: String,
}

fn should_stop_reading(buf: &[u8], scan_from: usize) -> bool {
    buf.len() >= preview::MAX_HTML_BYTES || meta::head_end_at(buf, scan_from).is_some()
}

pub async fn fetch_page(client: &reqwest::Client, url: &str) -> Result<FetchedPage, FetchError> {
    if !is_http_scheme(url) {
        return Err(FetchError::BadScheme);
    }

    let mut resp = client.get(url).send().await?;
    let final_url = resp.url().to_string();
    if !is_http_scheme(&final_url) {
        return Err(FetchError::BadScheme);
    }
    if !resp.status().is_success() {
        return Err(FetchError::Status(resp.status().as_u16()));
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !(content_type.contains("text/html") || content_type.contains("xhtml")) {
        return Err(FetchError::NotHtml);
    }

    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    while let Some(chunk) = resp.chunk().await? {
        let scan_from = buf.len().saturating_sub(6);
        buf.extend_from_slice(&chunk);
        if should_stop_reading(&buf, scan_from) {
            break;
        }
    }
    drop(resp);

    Ok(FetchedPage { final_url, body: buf, content_type })
}

pub struct FetchedImage {
    pub status_ok: bool,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

pub async fn fetch_image(client: &reqwest::Client, url: &str) -> Result<FetchedImage, FetchError> {
    if !is_http_scheme(url) {
        return Err(FetchError::BadScheme);
    }

    let mut resp = client.get(url).send().await?;
    let status_ok = resp.status().is_success();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut bytes: Vec<u8> = Vec::with_capacity(64 * 1024);
    while let Some(chunk) = resp.chunk().await? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > trove_core::preview::MAX_IMAGE_BYTES {
            break;
        }
    }
    drop(resp);

    Ok(FetchedImage { status_ok, content_type, bytes })
}

pub struct PreviewOutcome {
    pub file: Option<String>,
    pub origin: Option<PreviewOrigin>,
    pub title: Option<String>,
    pub blocked: bool,
}

async fn accept_and_write(
    fetcher: &Fetcher,
    candidate_url: &str,
    previews_dir: &Path,
    key: &str,
) -> Option<String> {
    let image = fetch_image(&fetcher.client, candidate_url).await.ok()?;
    let ext = preview::accept_image(image.status_ok, &image.content_type, &image.bytes).ok()?;
    preview::write_preview(previews_dir, key, ext, &image.bytes).ok()
}

pub async fn resolve_preview(
    fetcher: &Fetcher,
    url: &str,
    url_normalized: &str,
    previews_dir: &Path,
) -> Result<PreviewOutcome, FetchError> {
    let parsed = url::Url::parse(url).map_err(|_| FetchError::BadScheme)?;
    let action = host_rules::apply(&parsed);
    let key = preview::preview_key(url_normalized);

    if let Some(thumb_url) = action.direct_thumb {
        let file = accept_and_write(fetcher, thumb_url.as_str(), previews_dir, &key).await;
        return Ok(PreviewOutcome {
            origin: file.as_ref().map(|_| PreviewOrigin::HostRule),
            file,
            title: None,
            blocked: false,
        });
    }

    let read_url = action.meta_url.map(|u| u.to_string()).unwrap_or_else(|| url.to_string());
    let page = fetch_page(&fetcher.client, &read_url).await?;
    let html = meta::decode_html(&page.body, &page.content_type);
    let final_url = url::Url::parse(&page.final_url).map_err(|_| FetchError::BadScheme)?;
    let page_meta = meta::extract(&html, &final_url);
    let host = final_url.host_str().unwrap_or("");
    let blocked = meta::is_soft_block(&page_meta, page.body.len(), host);

    if blocked {
        return Ok(PreviewOutcome { file: None, origin: None, title: None, blocked: true });
    }

    let mut candidates: Vec<(String, PreviewOrigin)> = Vec::new();
    if let Some(img) = &page_meta.image {
        candidates.push((img.to_string(), PreviewOrigin::Og));
    }
    for icon in &page_meta.icons {
        let origin = if icon.apple { PreviewOrigin::AppleTouch } else { PreviewOrigin::Favicon };
        candidates.push((icon.url.to_string(), origin));
    }

    for (candidate_url, origin) in candidates {
        if let Some(file) = accept_and_write(fetcher, &candidate_url, previews_dir, &key).await {
            return Ok(PreviewOutcome { file: Some(file), origin: Some(origin), title: page_meta.title, blocked: false });
        }
    }

    Ok(PreviewOutcome { file: None, origin: None, title: page_meta.title, blocked: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_stop_reading_true_exactly_at_cap() {
        let buf = vec![b'a'; preview::MAX_HTML_BYTES];
        assert!(should_stop_reading(&buf, 0));
    }

    #[test]
    fn should_stop_reading_false_one_byte_under_cap() {
        let buf = vec![b'a'; preview::MAX_HTML_BYTES - 1];
        assert!(!should_stop_reading(&buf, 0));
    }

    #[test]
    fn should_stop_reading_true_one_byte_over_cap() {
        let buf = vec![b'a'; preview::MAX_HTML_BYTES + 1];
        assert!(should_stop_reading(&buf, 0));
    }

    #[test]
    fn should_stop_reading_true_when_head_closes_within_buffer() {
        let buf = b"<html><head></head><body></body></html>".to_vec();
        assert!(should_stop_reading(&buf, 0));
    }

    #[test]
    fn should_stop_reading_false_without_cap_or_closing_tag() {
        let buf = b"<html><head><title>Doc</title>".to_vec();
        assert!(!should_stop_reading(&buf, 0));
    }
}
