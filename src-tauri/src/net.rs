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
