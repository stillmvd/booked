use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use scraper::{Html, Selector};
use url::{Host, Url};

use crate::downloads::Reason;
use crate::game_import::safe_name;

pub const PIXELDRAIN: &str = "PIXELDRAIN";
pub const BUZZHEAVIER: &str = "BUZZHEAVIER";
pub const MEDIAFIRE: &str = "MEDIAFIRE";
pub const DATANODES: &str = "DATANODES";
pub const FILE: &str = "FILE";
pub const ARCHIVE_EXTENSIONS: [&str; 3] = ["zip", "7z", "rar"];

const FORUM: &str = "FORUM";
const BROWSER_ONLY: [&str; 4] = [DATANODES, BUZZHEAVIER, "MEGA", "GOFILE"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub host: String,
    pub url: String,
    pub file: Option<String>,
}

fn domain_of(host: &str) -> &'static [&'static str] {
    match host {
        PIXELDRAIN => &["pixeldrain.com"],
        BUZZHEAVIER => &["buzzheavier.com", "bzzhr.to"],
        MEDIAFIRE => &["mediafire.com"],
        DATANODES => &["datanodes.to"],
        "MEGA" => &["mega.nz", "mega.io"],
        "GOFILE" => &["gofile.io"],
        FORUM => &["f95zone.to"],
        _ => &[],
    }
}

pub fn parse_link(raw: &str) -> Result<Link, &'static str> {
    let text = raw.trim();
    let parsed = Url::parse(text)
        .ok()
        .filter(is_public_https)
        .ok_or("Не похоже на ссылку — скопируй адрес страницы с файлом из браузера")?;
    if on_domain(&parsed, FORUM) {
        return Err("Это ссылка на тему форума — открой её и скопируй адрес файлообменника, куда она ведёт");
    }
    if BROWSER_ONLY.iter().any(|host| on_domain(&parsed, host)) {
        return Err("С этого файлообменника Booked не скачивает — возьми ссылку Pixeldrain, MediaFire или прямую на файл");
    }
    let url = parsed.to_string();
    if on_domain(&parsed, PIXELDRAIN) {
        pixeldrain_direct(&url).map_err(|_| "Проверь ссылку: нужен вид pixeldrain.com/u/…")?;
        return Ok(Link { host: PIXELDRAIN.to_string(), url, file: None });
    }
    if on_domain(&parsed, MEDIAFIRE) {
        return Ok(Link { host: MEDIAFIRE.to_string(), url, file: None });
    }
    Ok(Link { host: FILE.to_string(), url: url.clone(), file: Some(url) })
}

fn on_domain(parsed: &Url, host: &str) -> bool {
    let Some(name) = parsed.host_str().map(str::to_lowercase) else {
        return false;
    };
    parsed.scheme() == "https"
        && domain_of(host).iter().any(|domain| name == *domain || name.ends_with(&format!(".{domain}")))
}

fn segments(parsed: &Url) -> Vec<String> {
    parsed
        .path_segments()
        .map(|parts| parts.filter(|part| !part.is_empty()).map(str::to_string).collect())
        .unwrap_or_default()
}

pub fn pixeldrain_direct(page: &str) -> Result<String, Reason> {
    let parsed = Url::parse(page).map_err(|_| Reason::Other)?;
    if !on_domain(&parsed, PIXELDRAIN) {
        return Err(Reason::Other);
    }
    match segments(&parsed).as_slice() {
        [kind, id] if kind == "u" && !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()) => {
            Ok(format!("https://pixeldrain.com/api/file/{id}?download"))
        }
        _ => Err(Reason::Other),
    }
}

pub fn is_public_https(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host() {
        Some(Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            name != "localhost" && !name.ends_with(".localhost")
        }
        _ => false,
    }
}

pub fn mediafire_direct(html: &str) -> Result<String, Reason> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("#downloadButton").map_err(|_| Reason::Other)?;
    let button = document.select(&selector).next().ok_or(Reason::Expired)?;
    let scrambled = button.value().attr("data-scrambled-url").filter(|value| !value.is_empty());
    let candidate = match scrambled {
        Some(encoded) => {
            let bytes = STANDARD.decode(encoded.trim()).map_err(|_| Reason::Other)?;
            String::from_utf8(bytes).map_err(|_| Reason::Other)?
        }
        None => button.value().attr("href").unwrap_or_default().to_string(),
    };
    let parsed = Url::parse(candidate.trim()).map_err(|_| Reason::Expired)?;
    if !on_domain(&parsed, MEDIAFIRE) {
        return Err(Reason::Expired);
    }
    Ok(parsed.to_string())
}

fn percent_decode(raw: &str) -> Vec<u8> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let hex = |byte: u8| (byte as char).to_digit(16);
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                out.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}

fn split_params(header: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut quoted = false;
    let mut start = 0;
    for (index, c) in header.char_indices() {
        match c {
            '"' => quoted = !quoted,
            ';' if !quoted => {
                parts.push(&header[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(&header[start..]);
    parts
}

fn disposition_param(header: &str, key: &str) -> Option<String> {
    for part in split_params(header).into_iter().skip(1) {
        let Some((name, value)) = part.split_once('=') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case(key) {
            return Some(value.trim().to_string());
        }
    }
    None
}

pub fn content_disposition_name(header: &str) -> Option<String> {
    if let Some(extended) = disposition_param(header, "filename*") {
        let encoded = extended.split_once("''").map(|(_, rest)| rest).unwrap_or(&extended);
        if let Ok(text) = String::from_utf8(percent_decode(encoded.trim_matches('"'))) {
            if !text.trim().is_empty() {
                return Some(text);
            }
        }
    }
    let plain = disposition_param(header, "filename")?;
    let unquoted = plain.trim_matches('"').trim();
    (!unquoted.is_empty()).then(|| unquoted.to_string())
}

pub fn name_from_url(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let last = segments(&parsed).pop()?;
    String::from_utf8(percent_decode(&last)).ok().filter(|name| !name.trim().is_empty())
}

pub fn clean_file_name(raw: &str) -> String {
    match raw.rsplit_once('.') {
        Some((stem, ext)) if !stem.trim().is_empty() && !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()) => {
            format!("{}.{ext}", safe_name(stem))
        }
        _ => safe_name(raw),
    }
}

pub fn is_archive_name(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(stem, ext)| !stem.is_empty() && ARCHIVE_EXTENSIONS.iter().any(|known| known.eq_ignore_ascii_case(ext)))
}

pub fn file_name_for(disposition: Option<&str>, url: &str) -> Option<String> {
    disposition
        .and_then(content_disposition_name)
        .or_else(|| name_from_url(url))
        .map(|raw| clean_file_name(&raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_link_knows_pixeldrain_and_mediafire_pages() {
        let pixel = parse_link("  https://pixeldrain.com/u/AbC123 ").unwrap();
        assert_eq!((pixel.host.as_str(), pixel.url.as_str(), pixel.file), (PIXELDRAIN, "https://pixeldrain.com/u/AbC123", None));
        let fire = parse_link("https://www.mediafire.com/file/x/game.zip/file").unwrap();
        assert_eq!((fire.host.as_str(), fire.file), (MEDIAFIRE, None));
        assert!(parse_link("https://pixeldrain.com/l/AbC123").is_err());
    }

    #[test]
    fn parse_link_takes_any_other_public_link_as_a_file() {
        let link = parse_link("https://cdn.example.net/files/game.7z").unwrap();
        assert_eq!(link.host, FILE);
        assert_eq!(link.file.as_deref(), Some("https://cdn.example.net/files/game.7z"));
    }

    #[test]
    fn parse_link_rejects_forum_browser_hosts_and_non_links() {
        for raw in [
            "",
            "просто текст",
            "http://cdn.example.net/game.zip",
            "https://127.0.0.1/game.zip",
            "https://localhost/game.zip",
            "https://f95zone.to/threads/123/",
            "https://f95zone.to/masked/pixeldrain.com/2/1/abc",
            "https://datanodes.to/abc/game.zip",
            "https://buzzheavier.com/abc",
            "https://bzzhr.to/abc",
            "https://mega.nz/file/abc",
            "https://gofile.io/d/abc",
        ] {
            assert!(parse_link(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn parse_link_matches_hosts_by_domain_not_by_substring() {
        let host = |raw: &str| parse_link(raw).map(|link| link.host);
        assert_eq!(host("https://www.mediafire.com/file/x/y.zip/file"), Ok(MEDIAFIRE.to_string()));
        assert_eq!(host("https://pixeldrain.com.evil.io/u/abc"), Ok(FILE.to_string()));
        assert_eq!(host("https://notpixeldrain.com/u/abc"), Ok(FILE.to_string()));
        assert!(parse_link("https://sub.buzzheavier.com/abc").is_err());
        assert!(parse_link("http://pixeldrain.com/u/abc").is_err());
    }

    #[test]
    fn pixeldrain_file_page_becomes_api_download() {
        assert_eq!(
            pixeldrain_direct("https://pixeldrain.com/u/AbC123"),
            Ok("https://pixeldrain.com/api/file/AbC123?download".to_string())
        );
        assert_eq!(pixeldrain_direct("https://pixeldrain.com/l/AbC123"), Err(Reason::Other));
        assert_eq!(pixeldrain_direct("https://pixeldrain.com/u/"), Err(Reason::Other));
        assert_eq!(pixeldrain_direct("https://example.com/u/abc"), Err(Reason::Other));
    }

    #[test]
    fn mediafire_button_href_is_taken() {
        let html = r#"<html><body><a class="input" id="downloadButton" href="https://download1234.mediafire.com/abc/file.zip">Download</a></body></html>"#;
        assert_eq!(
            mediafire_direct(html),
            Ok("https://download1234.mediafire.com/abc/file.zip".to_string())
        );
    }

    #[test]
    fn mediafire_scrambled_url_is_decoded() {
        let encoded = STANDARD.encode("https://download9.mediafire.com/x/игра.zip");
        let html = format!(r##"<a id="downloadButton" href="#" data-scrambled-url="{encoded}">Download</a>"##);
        let direct = mediafire_direct(&html).unwrap();
        assert!(direct.starts_with("https://download9.mediafire.com/x/"));
    }

    #[test]
    fn mediafire_without_button_or_foreign_link_is_expired() {
        assert_eq!(mediafire_direct("<html><body>Файл удалён</body></html>"), Err(Reason::Expired));
        assert_eq!(
            mediafire_direct(r#"<a id="downloadButton" href="https://evil.example/a.zip">x</a>"#),
            Err(Reason::Expired)
        );
        assert_eq!(mediafire_direct(r#"<a id="downloadButton" href="javascript:void(0)">x</a>"#), Err(Reason::Expired));
    }

    #[test]
    fn content_disposition_plain_and_quoted() {
        assert_eq!(content_disposition_name(r#"attachment; filename="Game v1.0.zip""#).as_deref(), Some("Game v1.0.zip"));
        assert_eq!(content_disposition_name("attachment; filename=Game.7z").as_deref(), Some("Game.7z"));
        assert_eq!(content_disposition_name("attachment"), None);
    }

    #[test]
    fn content_disposition_extended_name_decodes_cyrillic() {
        let header = "attachment; filename=\"fallback.zip\"; filename*=UTF-8''%D0%A2%D1%91%D0%BC%D0%BD%D1%8B%D0%B9%20%D0%BB%D0%B5%D1%81.zip";
        assert_eq!(content_disposition_name(header).as_deref(), Some("Тёмный лес.zip"));
    }

    #[test]
    fn name_falls_back_to_the_last_url_segment() {
        assert_eq!(
            file_name_for(None, "https://cdn.example.net/files/%D0%98%D0%B3%D1%80%D0%B0-v2.rar?token=1").as_deref(),
            Some("Игра-v2.rar")
        );
        assert_eq!(
            file_name_for(Some("attachment; filename=\"a.zip\""), "https://cdn.example.net/b.rar").as_deref(),
            Some("a.zip")
        );
    }

    #[test]
    fn file_names_lose_windows_forbidden_characters() {
        let cleaned = clean_file_name("Игра: часть 1/2?.zip");
        assert!(!cleaned.contains([':', '/', '?']));
        assert!(cleaned.ends_with(".zip"));
        assert!(cleaned.contains("Игра"));
    }

    #[test]
    fn file_link_rejects_ip_literals_localhost_and_plain_http() {
        assert!(parse_link("https://cdn.example.net/a.zip").is_ok());
        assert!(parse_link("https://127.0.0.1/a.zip").is_err());
        assert!(parse_link("https://[::1]/a.zip").is_err());
        assert!(parse_link("https://192.168.0.5/a.zip").is_err());
        assert!(parse_link("https://localhost/a.zip").is_err());
        assert!(parse_link("https://app.localhost/a.zip").is_err());
        assert!(parse_link("http://cdn.example.net/a.zip").is_err());
        assert!(parse_link("//cdn.example.net/a.zip").is_err());
    }

    #[test]
    fn public_https_check_is_strict() {
        assert!(is_public_https(&Url::parse("https://cdn.example.net/a").unwrap()));
        assert!(!is_public_https(&Url::parse("http://cdn.example.net/a").unwrap()));
        assert!(!is_public_https(&Url::parse("https://10.0.0.1/a").unwrap()));
    }

    #[test]
    fn content_disposition_skips_params_without_equals_and_keeps_quoted_semicolons() {
        assert_eq!(
            content_disposition_name(r#"attachment; foo; filename="a;b.zip""#).as_deref(),
            Some("a;b.zip")
        );
    }

    #[test]
    fn reserved_names_get_underscore_before_the_extension() {
        assert_eq!(clean_file_name("con.zip"), "con_.zip");
        assert_eq!(clean_file_name("NUL.7z"), "NUL_.7z");
        assert_eq!(clean_file_name("Игра v1.0.zip"), "Игра v1.0.zip");
        assert!(is_archive_name(&clean_file_name("con.zip")));
    }

    #[test]
    fn archive_extension_check_ignores_case() {
        assert!(is_archive_name("Игра.ZIP"));
        assert!(is_archive_name("a.b.7z"));
        assert!(is_archive_name("x.Rar"));
        assert!(!is_archive_name("setup.exe"));
        assert!(!is_archive_name("zip"));
        assert!(!is_archive_name(".zip"));
    }
}
