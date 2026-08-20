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

pub fn parse(_input: &str) -> Result<ParsedUrl, UrlError> {
    unimplemented!()
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
