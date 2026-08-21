use std::time::Duration;

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
    #[allow(dead_code)]
    pub content_type: String,
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
        if buf.len() >= trove_core::preview::MAX_HTML_BYTES {
            break;
        }
        if buf[scan_from..].windows(6).any(|w| w.eq_ignore_ascii_case(b"</head")) {
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
