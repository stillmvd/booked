use scraper::{Html, Selector};
use std::collections::HashMap;
use std::sync::OnceLock;
use url::Url;

pub const SOFT_BLOCK_MAX_BODY: usize = 15 * 1024;

const CHALLENGE_TITLES: &[&str] = &["just a moment...", "just a moment…", "attention required!"];

#[derive(Debug, Clone, PartialEq)]
pub struct IconRef {
    pub url: Url,
    pub edge: u32,
    pub apple: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PageMeta {
    pub title: Option<String>,
    pub image: Option<Url>,
    pub icons: Vec<IconRef>,
    pub has_og: bool,
}

fn cached(slot: &'static OnceLock<Selector>, css: &'static str) -> &'static Selector {
    slot.get_or_init(|| Selector::parse(css).expect("static selector"))
}

fn rel_tokens(rel: &str) -> Vec<String> {
    rel.to_ascii_lowercase()
        .split_ascii_whitespace()
        .map(|t| t.to_string())
        .collect()
}

fn icon_edge(sizes: &str, apple: bool) -> u32 {
    let mut max: Option<u32> = None;
    for token in sizes.split_ascii_whitespace() {
        if token.eq_ignore_ascii_case("any") {
            return 1000;
        }
        if let Some(head) = token.split(['x', 'X']).next() {
            if let Ok(n) = head.parse::<u32>() {
                max = Some(max.map_or(n, |m| m.max(n)));
            }
        }
    }
    max.unwrap_or(if apple { 180 } else { 0 })
}

pub fn rank_icons(icons: &mut Vec<IconRef>) {
    icons.sort_by(|a, b| b.edge.cmp(&a.edge));
}

pub fn extract(html: &str, base: &Url) -> PageMeta {
    static META: OnceLock<Selector> = OnceLock::new();
    static LINK: OnceLock<Selector> = OnceLock::new();
    static TITLE: OnceLock<Selector> = OnceLock::new();

    let doc = Html::parse_document(html);
    let mut m: HashMap<String, String> = HashMap::new();
    for e in doc.select(cached(&META, "meta")) {
        let v = e.value();
        if let (Some(k), Some(c)) = (v.attr("property").or_else(|| v.attr("name")), v.attr("content")) {
            let key = k.trim().to_ascii_lowercase();
            let val = c.trim();
            if !val.is_empty() {
                m.entry(key).or_insert_with(|| val.to_owned());
            }
        }
    }

    let has_og = m.keys().any(|k| k.starts_with("og:"));

    let pick = |keys: &[&str]| keys.iter().find_map(|k| m.get(*k)).cloned();
    let image = pick(&[
        "og:image",
        "og:image:url",
        "og:image:secure_url",
        "twitter:image",
        "twitter:image:src",
    ])
    .and_then(|v| base.join(&v).ok())
    .filter(|u| matches!(u.scheme(), "http" | "https"));

    let mut icons = Vec::new();
    for e in doc.select(cached(&LINK, "link[rel][href]")) {
        let v = e.value();
        let tokens = rel_tokens(v.attr("rel").unwrap_or_default());
        if tokens.iter().any(|t| t == "mask-icon" || t == "fluid-icon") {
            continue;
        }
        let apple = tokens
            .iter()
            .any(|t| t == "apple-touch-icon" || t == "apple-touch-icon-precomposed");
        let is_icon = apple || tokens.iter().any(|t| t == "icon");
        if !is_icon {
            continue;
        }
        let edge = icon_edge(v.attr("sizes").unwrap_or(""), apple);
        if let Ok(u) = base.join(v.attr("href").unwrap_or_default()) {
            if matches!(u.scheme(), "http" | "https" | "data") {
                icons.push(IconRef { url: u, edge, apple });
            }
        }
    }
    rank_icons(&mut icons);

    let title = pick(&["og:title", "twitter:title"])
        .or_else(|| {
            doc.select(cached(&TITLE, "title"))
                .next()
                .map(|t| t.text().collect::<String>().trim().to_owned())
        })
        .filter(|s| !s.is_empty());

    PageMeta { title, image, icons, has_og }
}

fn charset_from_content_type(content_type: &str) -> Option<String> {
    content_type.split(';').find_map(|part| {
        let part = part.trim();
        let rest = part.strip_prefix("charset=")?;
        Some(rest.trim_matches(['"', '\'']).to_string())
    })
}

fn charset_from_head_bytes(bytes: &[u8]) -> Option<String> {
    let scan_len = bytes.len().min(1024);
    let scan = String::from_utf8_lossy(&bytes[..scan_len]).to_ascii_lowercase();
    let pos = scan.find("charset=")?;
    let after = &scan[pos + "charset=".len()..];
    let value: String = after
        .trim_start_matches(['"', '\''])
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

pub fn decode_html(bytes: &[u8], content_type: &str) -> String {
    let charset = charset_from_content_type(content_type).or_else(|| charset_from_head_bytes(bytes));

    if let Some(name) = charset {
        if !name.eq_ignore_ascii_case("utf-8") && !name.eq_ignore_ascii_case("utf8") {
            if let Some(encoding) = encoding_rs::Encoding::for_label(name.as_bytes()) {
                if encoding != encoding_rs::UTF_8 {
                    return encoding.decode(bytes).0.into_owned();
                }
            }
        }
    }

    String::from_utf8_lossy(bytes).into_owned()
}

fn host_label(host: &str) -> String {
    let stripped = host.strip_prefix("www.").unwrap_or(host);
    stripped.split('.').next().unwrap_or(stripped).to_ascii_lowercase()
}

pub fn is_soft_block(meta: &PageMeta, body_len: usize, host: &str) -> bool {
    if meta.has_og {
        return false;
    }
    if body_len < SOFT_BLOCK_MAX_BODY {
        return true;
    }
    let title = meta.title.as_deref().unwrap_or("").trim().to_ascii_lowercase();
    if title.is_empty() {
        return false;
    }
    let host_no_www = host.strip_prefix("www.").unwrap_or(host).to_ascii_lowercase();
    if title == host_no_www || title == host_label(host) {
        return true;
    }
    CHALLENGE_TITLES.iter().any(|c| title == *c)
}

pub fn head_end_at(buf: &[u8], from: usize) -> Option<usize> {
    if buf.len() < 6 {
        return None;
    }
    let start = from.min(buf.len());
    buf[start..]
        .windows(6)
        .position(|w| w.eq_ignore_ascii_case(b"</head"))
        .map(|p| start + p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_meta_declaration_wins_over_duplicate_key() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head>
            <meta property="og:image" content="https://example.test/first.jpg">
            <meta property="og:image" content="https://example.test/second.jpg">
        </head></html>"#;
        let meta = extract(html, &base);
        assert_eq!(meta.image.unwrap().as_str(), "https://example.test/first.jpg");
    }

    #[test]
    fn image_falls_back_through_priority_list() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<meta name="twitter:image" content="https://example.test/tw.jpg">"#;
        let meta = extract(html, &base);
        assert_eq!(meta.image.unwrap().as_str(), "https://example.test/tw.jpg");
    }

    #[test]
    fn image_resolves_relative_href_against_base() {
        let base = Url::parse("https://example.test/articles/post").unwrap();
        let html = r#"<meta property="og:image" content="../images/cover.jpg">"#;
        let meta = extract(html, &base);
        assert_eq!(meta.image.unwrap().as_str(), "https://example.test/images/cover.jpg");
    }

    #[test]
    fn image_resolves_protocol_relative_href() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<meta property="og:image" content="//cdn.example.test/a.jpg">"#;
        let meta = extract(html, &base);
        assert_eq!(meta.image.unwrap().as_str(), "https://cdn.example.test/a.jpg");
    }

    #[test]
    fn image_rejects_non_http_scheme() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<meta property="og:image" content="javascript:alert(1)">"#;
        let meta = extract(html, &base);
        assert!(meta.image.is_none());
    }

    #[test]
    fn rel_token_list_recognizes_six_accepted_forms() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head>
            <link rel="icon" href="/a.png">
            <link rel="shortcut icon" href="/b.png">
            <link rel="alternate icon" href="/c.png">
            <link rel="icon shortcut" href="/d.png">
            <link rel="apple-touch-icon" href="/e.png">
            <link rel="apple-touch-icon-precomposed" href="/f.png">
        </head></html>"#;
        let meta = extract(html, &base);
        assert_eq!(meta.icons.len(), 6);
    }

    #[test]
    fn icon_with_javascript_scheme_is_dropped() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<link rel="icon" href="javascript:alert(1)">"#;
        let meta = extract(html, &base);
        assert!(meta.icons.is_empty());
    }

    #[test]
    fn icon_with_data_uri_scheme_is_kept() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<link rel="icon" href="data:image/png;base64,AAAA">"#;
        let meta = extract(html, &base);
        assert_eq!(meta.icons.len(), 1);
        assert_eq!(meta.icons[0].url.scheme(), "data");
    }

    #[test]
    fn rel_token_list_rejects_mask_icon_and_fluid_icon() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head>
            <link rel="mask-icon" href="/m.svg">
            <link rel="icon mask-icon" href="/n.svg">
            <link rel="fluid-icon" href="/o.png">
        </head></html>"#;
        let meta = extract(html, &base);
        assert!(meta.icons.is_empty());
    }

    #[test]
    fn rank_icons_uses_declared_size() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head>
            <link rel="icon" href="/small.png" sizes="32x32">
            <link rel="icon" href="/big.png" sizes="192x192">
        </head></html>"#;
        let meta = extract(html, &base);
        assert_eq!(meta.icons[0].edge, 192);
        assert!(meta.icons[0].url.as_str().ends_with("big.png"));
    }

    #[test]
    fn rank_icons_scores_bare_apple_touch_icon_as_180() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head><link rel="apple-touch-icon" href="/apple.png"></head></html>"#;
        let meta = extract(html, &base);
        assert_eq!(meta.icons[0].edge, 180);
        assert!(meta.icons[0].apple);
    }

    #[test]
    fn rank_icons_scores_any_as_1000() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head><link rel="icon" href="/vector.svg" sizes="any"></head></html>"#;
        let meta = extract(html, &base);
        assert_eq!(meta.icons[0].edge, 1000);
    }

    #[test]
    fn rank_icons_scores_missing_size_as_zero() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head><link rel="icon" href="/plain.png"></head></html>"#;
        let meta = extract(html, &base);
        assert_eq!(meta.icons[0].edge, 0);
    }

    #[test]
    fn rank_icons_is_stable_on_tie() {
        let mut icons = vec![
            IconRef { url: Url::parse("https://example.test/first.png").unwrap(), edge: 32, apple: false },
            IconRef { url: Url::parse("https://example.test/second.png").unwrap(), edge: 32, apple: false },
        ];
        rank_icons(&mut icons);
        assert!(icons[0].url.as_str().ends_with("first.png"));
    }

    #[test]
    fn title_prefers_og_then_twitter_then_document_title() {
        let base = Url::parse("https://example.test/").unwrap();
        let og = extract(r#"<meta property="og:title" content="OG"><title>Doc</title>"#, &base);
        assert_eq!(og.title.as_deref(), Some("OG"));

        let tw = extract(r#"<meta name="twitter:title" content="TW"><title>Doc</title>"#, &base);
        assert_eq!(tw.title.as_deref(), Some("TW"));

        let doc = extract(r#"<title>  Doc Title  </title>"#, &base);
        assert_eq!(doc.title.as_deref(), Some("Doc Title"));
    }

    #[test]
    fn title_empty_string_is_not_used() {
        let base = Url::parse("https://example.test/").unwrap();
        let meta = extract(r#"<meta property="og:title" content="   "><title>Fallback</title>"#, &base);
        assert_eq!(meta.title.as_deref(), Some("Fallback"));
    }

    #[test]
    fn decode_html_plain_utf8_without_declaration() {
        let html = "<title>Plain</title>";
        let decoded = decode_html(html.as_bytes(), "text/html");
        assert_eq!(decoded, html);
    }

    #[test]
    fn decode_html_windows1251_via_content_type_header() {
        let title = "Заголовок";
        let html = format!("<html><head><title>{title}</title></head></html>");
        let (bytes, _, _) = encoding_rs::WINDOWS_1251.encode(&html);
        let decoded = decode_html(&bytes, "text/html; charset=windows-1251");
        assert!(decoded.contains(title));
    }

    #[test]
    fn decode_html_windows1251_via_meta_declaration() {
        let title = "Заголовок";
        let html = format!(
            "<html><head><meta charset=\"windows-1251\"><title>{title}</title></head></html>"
        );
        let (bytes, _, _) = encoding_rs::WINDOWS_1251.encode(&html);
        let decoded = decode_html(&bytes, "text/html");
        assert!(decoded.contains(title));
    }

    #[test]
    fn decode_html_tolerates_invalid_byte_sequence() {
        let bytes = vec![0xFF, 0xFE, b'a', b'b'];
        let decoded = decode_html(&bytes, "text/html");
        assert!(decoded.contains('a'));
    }

    #[test]
    fn soft_block_true_for_short_body_without_meta_tags() {
        let meta = PageMeta { title: Some("Reddit".into()), has_og: false, ..Default::default() };
        assert!(is_soft_block(&meta, 8_400, "www.reddit.com"));
    }

    #[test]
    fn soft_block_false_for_long_body_with_meta_tag() {
        let meta = PageMeta { has_og: true, ..Default::default() };
        assert!(!is_soft_block(&meta, 136_000, "old.reddit.com"));
    }

    #[test]
    fn soft_block_true_for_title_matching_host_even_when_body_long() {
        let meta = PageMeta { title: Some("Reddit".into()), has_og: false, ..Default::default() };
        assert!(is_soft_block(&meta, 20_000, "www.reddit.com"));
    }

    #[test]
    fn soft_block_false_for_short_body_with_og_present() {
        let base = Url::parse("https://example.test/").unwrap();
        let meta = PageMeta { has_og: true, image: base.join("a.jpg").ok(), ..Default::default() };
        assert!(!is_soft_block(&meta, 5_000, "example.test"));
    }

    #[test]
    fn head_end_finds_tag_fully_inside_chunk() {
        let buf = b"<html><head></head><body></body></html>".to_vec();
        let idx = head_end_at(&buf, 0).unwrap();
        assert!(buf[idx..idx + 6].eq_ignore_ascii_case(b"</head"));
    }

    #[test]
    fn head_end_finds_tag_split_across_chunk_boundary() {
        let mut first = b"<html><head><title>Doc</title><".to_vec();
        let scan_from = first.len().saturating_sub(6);
        let second = b"/head></body></html>".to_vec();
        first.extend_from_slice(&second);
        let idx = head_end_at(&first, scan_from).unwrap();
        assert!(first[idx..idx + 6].eq_ignore_ascii_case(b"</head"));
    }

    #[test]
    fn head_end_returns_none_when_tag_absent() {
        let buf = b"<html><head><title>Doc</title>".to_vec();
        assert_eq!(head_end_at(&buf, 0), None);
    }

    #[test]
    fn extract_handles_truncated_head_without_panicking() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = r#"<html><head><meta property="og:image" content="https://example.test/a.jpg"><title>Cut off"#;
        let meta = extract(html, &base);
        assert_eq!(meta.image.unwrap().as_str(), "https://example.test/a.jpg");
    }
}
