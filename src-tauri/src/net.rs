use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use tauri::async_runtime::{channel, Mutex as AsyncMutex, Receiver, Sender};

use trove_core::favicons::{self, FaviconStatus};
use trove_core::host_rules;
use trove_core::meta;
use trove_core::preview::{self, PreviewOrigin};

use crate::db::Db;

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                       (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const GLOBAL_PERMITS: usize = 8;
const PER_HOST_PERMITS: usize = 2;

struct Semaphore {
    tx: Sender<()>,
    rx: AsyncMutex<Receiver<()>>,
}

impl Semaphore {
    fn new(permits: usize) -> Self {
        let (tx, rx) = channel(permits.max(1));
        for _ in 0..permits {
            let _ = tx.try_send(());
        }
        Semaphore { tx, rx: AsyncMutex::new(rx) }
    }

    async fn acquire(&self) -> SemaphorePermit {
        let mut guard = self.rx.lock().await;
        guard.recv().await.expect("semaphore channel closed");
        SemaphorePermit { tx: self.tx.clone() }
    }
}

struct SemaphorePermit {
    tx: Sender<()>,
}

impl Drop for SemaphorePermit {
    fn drop(&mut self) {
        let _ = self.tx.try_send(());
    }
}

pub struct FetchCancel(pub AtomicBool);

pub struct Fetcher {
    pub client: reqwest::Client,
    global: Semaphore,
    per_host: StdMutex<HashMap<String, Arc<Semaphore>>>,
    backoff: StdMutex<HashMap<String, Instant>>,
}

impl Fetcher {
    pub fn new(client: reqwest::Client) -> Self {
        Fetcher {
            client,
            global: Semaphore::new(GLOBAL_PERMITS),
            per_host: StdMutex::new(HashMap::new()),
            backoff: StdMutex::new(HashMap::new()),
        }
    }

    fn is_backed_off(&self, host: &str) -> bool {
        self.backoff
            .lock()
            .ok()
            .and_then(|map| map.get(host).copied())
            .map(|until| until > Instant::now())
            .unwrap_or(false)
    }

    fn note_retry_after(&self, host: &str, headers: &reqwest::header::HeaderMap) {
        let wait = headers
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(Duration::from_secs(3600))
            .min(Duration::from_secs(24 * 3600));
        if let Ok(mut map) = self.backoff.lock() {
            map.insert(host.to_string(), Instant::now() + wait);
        }
    }

    async fn slot(&self, host: &str) -> (SemaphorePermit, SemaphorePermit) {
        let per_host_sem = {
            let mut map = self.per_host.lock().unwrap();
            map.entry(host.to_string())
                .or_insert_with(|| Arc::new(Semaphore::new(PER_HOST_PERMITS)))
                .clone()
        };
        let host_permit = per_host_sem.acquire().await;
        let global_permit = self.global.acquire().await;
        (host_permit, global_permit)
    }
}

fn request_host(url: &str) -> Option<String> {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string))
}

pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 {
                return attempt.error("too many redirects");
            }
            if is_safe_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
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
    Backoff,
    Status(u16),
    Network(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::NotHtml => write!(f, "страница не является HTML"),
            FetchError::TooManyRedirects => write!(f, "слишком много перенаправлений"),
            FetchError::BadScheme => write!(f, "поддерживаются только http и https"),
            FetchError::Backoff => write!(f, "хост временно отложен из-за перегрузки"),
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

fn ipv4_is_forbidden(ip: &std::net::Ipv4Addr) -> bool {
    ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.octets()[0] == 0
}

fn is_ipv6_unique_local(seg0: u16) -> bool {
    seg0 & 0xfe00 == 0xfc00
}

fn is_ipv6_link_local(seg0: u16) -> bool {
    seg0 & 0xffc0 == 0xfe80
}

fn ipv6_is_forbidden(ip: &std::net::Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    if let Some(v4) = ip.to_ipv4_mapped() {
        return ipv4_is_forbidden(&v4);
    }
    let seg0 = ip.segments()[0];
    is_ipv6_unique_local(seg0) || is_ipv6_link_local(seg0)
}

// ponytail: блокируются литеральные приватные адреса; DNS rebinding требует своего коннектора с хуком резолвера
fn host_is_public(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => !ipv4_is_forbidden(&ip),
        Some(url::Host::Ipv6(ip)) => !ipv6_is_forbidden(&ip),
        Some(url::Host::Domain(domain)) => {
            let domain = domain.to_ascii_lowercase();
            domain != "localhost" && !domain.ends_with(".localhost")
        }
        None => false,
    }
}

fn is_safe_url(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https") && host_is_public(url)
}

fn is_safe_target(url: &str) -> bool {
    url::Url::parse(url).map(|parsed| is_safe_url(&parsed)).unwrap_or(false)
}

pub struct FetchedPage {
    pub final_url: String,
    pub body: Vec<u8>,
    pub content_type: String,
}

fn should_stop_reading(buf: &[u8], scan_from: usize) -> bool {
    buf.len() >= preview::MAX_HTML_BYTES || meta::head_end_at(buf, scan_from).is_some()
}

pub async fn fetch_page(fetcher: &Fetcher, url: &str) -> Result<FetchedPage, FetchError> {
    if !is_safe_target(url) {
        return Err(FetchError::BadScheme);
    }
    let host = request_host(url);
    if let Some(h) = &host {
        if fetcher.is_backed_off(h) {
            return Err(FetchError::Backoff);
        }
    }
    let _permits = match &host {
        Some(h) => Some(fetcher.slot(h).await),
        None => None,
    };

    let mut resp = fetcher.client.get(url).send().await?;
    let final_url = resp.url().to_string();
    if !is_safe_target(&final_url) {
        return Err(FetchError::BadScheme);
    }
    let status = resp.status();
    if let Some(h) = &host {
        if matches!(status.as_u16(), 429 | 503) {
            fetcher.note_retry_after(h, resp.headers());
        }
    }
    if !status.is_success() {
        return Err(FetchError::Status(status.as_u16()));
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

pub async fn fetch_image(fetcher: &Fetcher, url: &str) -> Result<FetchedImage, FetchError> {
    if !is_safe_target(url) {
        return Err(FetchError::BadScheme);
    }
    let host = request_host(url);
    if let Some(h) = &host {
        if fetcher.is_backed_off(h) {
            return Err(FetchError::Backoff);
        }
    }
    let _permits = match &host {
        Some(h) => Some(fetcher.slot(h).await),
        None => None,
    };

    let mut resp = fetcher.client.get(url).send().await?;
    let status = resp.status();
    if let Some(h) = &host {
        if matches!(status.as_u16(), 429 | 503) {
            fetcher.note_retry_after(h, resp.headers());
        }
    }
    let status_ok = status.is_success();
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

fn favicon_cache_lookup(db: &Db, host: &str) -> Option<favicons::FaviconRow> {
    let guard = db.0.lock().ok()?;
    let conn = guard.as_ref().ok()?;
    favicons::cached(conn, host).ok().flatten()
}

fn favicon_cache_record(db: &Db, host: &str, file: Option<&str>, status: FaviconStatus) {
    if let Ok(guard) = db.0.lock() {
        if let Ok(conn) = guard.as_ref() {
            let _ = favicons::record(conn, host, file, status);
        }
    }
}

async fn accept_and_write(
    fetcher: &Fetcher,
    candidate_url: &str,
    previews_dir: &Path,
    key: &str,
) -> Option<String> {
    let image = fetch_image(fetcher, candidate_url).await.ok()?;
    let ext = preview::accept_image(image.status_ok, &image.content_type, &image.bytes).ok()?;
    preview::write_preview(previews_dir, key, ext, &image.bytes).ok()
}

async fn write_icon_candidate(
    fetcher: &Fetcher,
    candidate_url: &str,
    icons_dir: &Path,
    key: &str,
) -> Option<String> {
    if let Some((bytes, ext)) = favicons::decode_data_uri(candidate_url) {
        return favicons::write_icon(icons_dir, key, &ext, &bytes).ok();
    }
    let image = fetch_image(fetcher, candidate_url).await.ok()?;
    let ext = preview::accept_image(image.status_ok, &image.content_type, &image.bytes).ok()?;
    favicons::write_icon(icons_dir, key, ext, &image.bytes).ok()
}

fn favicon_identity_host(bookmark_url: &url::Url) -> &str {
    bookmark_url.host_str().unwrap_or("")
}

async fn resolve_favicon(
    fetcher: &Fetcher,
    db: &Db,
    parsed: &url::Url,
    icons_dir: &Path,
    title: Option<String>,
) -> PreviewOutcome {
    let no_icon = |title: Option<String>| PreviewOutcome { file: None, origin: None, title, blocked: false };

    let host = match parsed.host_str() {
        Some(h) => h.to_string(),
        None => return no_icon(title),
    };

    if let Some(row) = favicon_cache_lookup(db, &host) {
        match row.status {
            FaviconStatus::Found => {
                if let Some(file) = row.file {
                    return PreviewOutcome {
                        file: Some(file),
                        origin: Some(PreviewOrigin::Favicon),
                        title,
                        blocked: false,
                    };
                }
            }
            FaviconStatus::Absent => return no_icon(title),
            FaviconStatus::Failed => {}
        }
    }

    let icon_key = favicons::icon_key(&host);
    let mut got_response = false;

    for (idx, guess_url) in favicons::guess_urls(parsed).into_iter().enumerate() {
        match fetch_image(fetcher, guess_url.as_str()).await {
            Ok(image) => {
                got_response = true;
                if let Ok(ext) = preview::accept_image(image.status_ok, &image.content_type, &image.bytes) {
                    if let Ok(file) = favicons::write_icon(icons_dir, &icon_key, ext, &image.bytes) {
                        let origin = if idx == 0 { PreviewOrigin::AppleTouch } else { PreviewOrigin::Favicon };
                        favicon_cache_record(db, &host, Some(&file), FaviconStatus::Found);
                        return PreviewOutcome { file: Some(file), origin: Some(origin), title, blocked: false };
                    }
                }
            }
            Err(_) => {}
        }
    }

    let status = if got_response { FaviconStatus::Absent } else { FaviconStatus::Failed };
    favicon_cache_record(db, &host, None, status);
    no_icon(title)
}

pub async fn resolve_preview(
    fetcher: &Fetcher,
    db: &Db,
    url: &str,
    url_normalized: &str,
    previews_dir: &Path,
    icons_dir: &Path,
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
    let page = fetch_page(fetcher, &read_url).await?;
    let html = meta::decode_html(&page.body, &page.content_type);
    let final_url = url::Url::parse(&page.final_url).map_err(|_| FetchError::BadScheme)?;
    let page_meta = meta::extract(&html, &final_url);
    let page_host = final_url.host_str().unwrap_or("");
    let blocked = meta::is_soft_block(&page_meta, page.body.len(), page_host);

    if !blocked {
        if let Some(img) = &page_meta.image {
            if let Some(file) = accept_and_write(fetcher, img.as_str(), previews_dir, &key).await {
                return Ok(PreviewOutcome { file: Some(file), origin: Some(PreviewOrigin::Og), title: page_meta.title, blocked: false });
            }
        }

        let bookmark_host = favicon_identity_host(&parsed);
        let markup_icon_key = favicons::icon_key(bookmark_host);
        for icon in &page_meta.icons {
            let origin = if icon.apple { PreviewOrigin::AppleTouch } else { PreviewOrigin::Favicon };
            if let Some(file) = write_icon_candidate(fetcher, icon.url.as_str(), icons_dir, &markup_icon_key).await {
                favicon_cache_record(db, bookmark_host, Some(&file), FaviconStatus::Found);
                return Ok(PreviewOutcome { file: Some(file), origin: Some(origin), title: page_meta.title, blocked: false });
            }
        }
    }

    let title = if blocked { None } else { page_meta.title };
    let mut outcome = resolve_favicon(fetcher, db, &parsed, icons_dir, title).await;
    if blocked && outcome.file.is_none() {
        outcome.blocked = true;
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_target_rejects_loopback_literal() {
        assert!(!is_safe_target("http://127.0.0.1/admin"));
        assert!(!is_safe_target("http://[::1]/admin"));
    }

    #[test]
    fn is_safe_target_rejects_private_ranges() {
        assert!(!is_safe_target("http://10.0.0.5/"));
        assert!(!is_safe_target("http://172.16.0.5/"));
        assert!(!is_safe_target("http://192.168.1.1/"));
        assert!(!is_safe_target("http://169.254.169.254/"));
        assert!(!is_safe_target("http://0.0.0.0/"));
    }

    #[test]
    fn is_safe_target_rejects_ipv6_unique_local_and_link_local() {
        assert!(!is_safe_target("http://[fc00::1]/"));
        assert!(!is_safe_target("http://[fe80::1]/"));
        assert!(!is_safe_target("http://[::ffff:127.0.0.1]/"));
    }

    #[test]
    fn is_safe_target_rejects_localhost_domain() {
        assert!(!is_safe_target("http://localhost/"));
        assert!(!is_safe_target("http://foo.localhost/"));
    }

    #[test]
    fn is_safe_target_rejects_non_http_scheme() {
        assert!(!is_safe_target("file:///etc/passwd"));
    }

    #[test]
    fn is_safe_target_accepts_public_url() {
        assert!(is_safe_target("https://example.com/page"));
        assert!(is_safe_target("http://8.8.8.8/"));
    }

    #[test]
    fn redirect_policy_guard_rejects_private_hop_target() {
        let hop = url::Url::parse("http://192.168.1.1/next").unwrap();
        assert!(!is_safe_url(&hop));
    }

    #[test]
    fn favicon_identity_host_uses_original_bookmark_host_not_redirect_target() {
        let bookmark_url = url::Url::parse("https://www.reddit.com/r/rust/").unwrap();
        let redirect_target = url::Url::parse("https://old.reddit.com/r/rust/").unwrap();
        assert_eq!(favicon_identity_host(&bookmark_url), "www.reddit.com");
        assert_ne!(favicon_identity_host(&bookmark_url), redirect_target.host_str().unwrap());
    }

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
