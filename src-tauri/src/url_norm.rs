use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedUrl {
    pub url: String,
    pub normalized: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum UrlError {
    Empty,
    UnsupportedScheme,
    SwitchLike,
    Malformed,
}

impl std::fmt::Display for UrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UrlError::Empty => write!(f, "адрес не может быть пустым"),
            UrlError::UnsupportedScheme => write!(f, "поддерживаются только http и https"),
            UrlError::SwitchLike => write!(f, "адрес не может начинаться с дефиса"),
            UrlError::Malformed => write!(f, "не удалось разобрать адрес"),
        }
    }
}

const TRACKING_PARAMS: &[&str] = &["fbclid", "gclid", "ref", "yclid"];

fn is_http_like(url: &Url) -> bool {
    url.scheme() == "http" || url.scheme() == "https"
}

fn build_normalized(parsed: &Url) -> String {
    let scheme = parsed.scheme();
    let host = parsed.host_str().unwrap_or("");
    let host = host.strip_prefix("www.").unwrap_or(host);

    let port_suffix = match parsed.port() {
        Some(port) if !((scheme == "http" && port == 80) || (scheme == "https" && port == 443)) => {
            format!(":{port}")
        }
        _ => String::new(),
    };

    let query: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(k, _)| !k.starts_with("utm_") && !TRACKING_PARAMS.contains(&k.as_ref()))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let query_suffix = if query.is_empty() {
        String::new()
    } else {
        let joined: Vec<String> = query
            .iter()
            .map(|(k, v)| if v.is_empty() { k.clone() } else { format!("{k}={v}") })
            .collect();
        format!("?{}", joined.join("&"))
    };

    let fragment_suffix = parsed.fragment().map(|f| format!("#{f}")).unwrap_or_default();

    let mut path = parsed.path().to_string();
    if path == "/" {
        if query_suffix.is_empty() && fragment_suffix.is_empty() {
            path.clear();
        }
    } else if path.ends_with('/') {
        path.pop();
    }

    format!("{scheme}://{host}{port_suffix}{path}{query_suffix}{fragment_suffix}")
}

pub fn parse(input: &str) -> Result<ParsedUrl, UrlError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(UrlError::Empty);
    }
    if trimmed.starts_with('-') {
        return Err(UrlError::SwitchLike);
    }

    let raw = Url::parse(trimmed);
    if let Ok(parsed) = &raw {
        if is_http_like(parsed) {
            return Ok(ParsedUrl {
                url: trimmed.to_string(),
                normalized: build_normalized(parsed),
            });
        }
        return Err(UrlError::UnsupportedScheme);
    }

    if !trimmed.contains("://") {
        let prefixed_input = format!("https://{trimmed}");
        if let Ok(parsed) = Url::parse(&prefixed_input) {
            if is_http_like(&parsed) {
                return Ok(ParsedUrl {
                    url: prefixed_input,
                    normalized: build_normalized(&parsed),
                });
            }
        }
    }

    Err(UrlError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_host_and_strips_www() {
        let parsed = parse("https://WWW.Example.COM/A/?utm_source=x&b=2#frag").unwrap();
        assert_eq!(parsed.url, "https://WWW.Example.COM/A/?utm_source=x&b=2#frag");
        assert_eq!(parsed.normalized, "https://example.com/A?b=2#frag");
    }

    #[test]
    fn strips_default_port() {
        let parsed = parse("https://example.com:443/x").unwrap();
        assert_eq!(parsed.normalized, "https://example.com/x");
    }

    #[test]
    fn strips_trailing_slash() {
        let parsed = parse("http://example.com:80/").unwrap();
        assert_eq!(parsed.normalized, "http://example.com");
    }

    #[test]
    fn coerces_bare_domain_with_https() {
        let parsed = parse("example.com/x").unwrap();
        assert_eq!(parsed.url, "https://example.com/x");
        assert_eq!(parsed.normalized, "https://example.com/x");
    }

    #[test]
    fn drops_tracking_params_keeps_others() {
        let parsed =
            parse("https://example.com/?fbclid=1&gclid=2&ref=3&yclid=4&utm_campaign=5&q=kept")
                .unwrap();
        assert_eq!(parsed.normalized, "https://example.com/?q=kept");
    }

    #[test]
    fn does_not_sort_query_params() {
        let a = parse("https://example.com/?b=2&a=1").unwrap();
        let b = parse("https://example.com/?a=1&b=2").unwrap();
        assert_eq!(a.normalized, "https://example.com/?b=2&a=1");
        assert_ne!(a.normalized, b.normalized);
    }

    #[test]
    fn fragment_distinguishes_urls() {
        let a = parse("https://a.com/docs/api#authentication").unwrap();
        let b = parse("https://a.com/docs/api#errors").unwrap();
        assert_ne!(a.normalized, b.normalized);
    }

    #[test]
    fn www_and_utm_variant_matches_plain_url() {
        let a = parse("https://www.example.com/a/?utm_source=x").unwrap();
        let b = parse("https://example.com/a").unwrap();
        assert_eq!(a.normalized, b.normalized);
    }

    #[test]
    fn rejects_javascript_scheme() {
        let err = parse("javascript:alert(1)").unwrap_err();
        assert_eq!(err, UrlError::UnsupportedScheme);
    }

    #[test]
    fn rejects_file_scheme() {
        let err = parse("file:///C:/secrets.txt").unwrap_err();
        assert_eq!(err, UrlError::UnsupportedScheme);
    }

    #[test]
    fn rejects_data_scheme() {
        let err = parse("data:text/html,<script>").unwrap_err();
        assert_eq!(err, UrlError::UnsupportedScheme);
    }

    #[test]
    fn rejects_switch_like_input() {
        let err = parse("--load-extension=C:\\evil").unwrap_err();
        assert_eq!(err, UrlError::SwitchLike);
    }

    #[test]
    fn rejects_empty_input() {
        let err = parse("   ").unwrap_err();
        assert_eq!(err, UrlError::Empty);
    }

    #[test]
    fn rejects_host_less_url() {
        let err = parse("https://").unwrap_err();
        assert_eq!(err, UrlError::Malformed);
    }
}
