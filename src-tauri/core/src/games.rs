use std::cmp::Ordering;

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

const PLATFORM_SUFFIXES: &[&str] = &[
    "pc",
    "win",
    "win32",
    "win64",
    "windows",
    "mac",
    "macos",
    "osx",
    "linux",
    "android",
    "compressed",
    "uncensored",
];

const EXE_SKIP_PARTS: &[&str] = &[
    "unins",
    "setup",
    "install",
    "vcredist",
    "directx",
    "dxwebsetup",
    "oalinst",
    "crashhandler",
    "crash_handler",
    "crash-handler",
    "crashreport",
    "python",
    "pythonw",
    "notification_helper",
    "zsync",
];

const MONTHS: &[(&str, u32)] = &[
    ("jan", 1),
    ("feb", 2),
    ("mar", 3),
    ("apr", 4),
    ("may", 5),
    ("jun", 6),
    ("jul", 7),
    ("aug", 8),
    ("sep", 9),
    ("oct", 10),
    ("nov", 11),
    ("dec", 12),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    F95,
    Itch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedFolder {
    pub title: String,
    pub base_name: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExeCandidate {
    pub path: String,
    pub size: u64,
    pub depth: u8,
}

pub fn parse_folder_name(name: &str) -> ParsedFolder {
    let mut tokens: Vec<&str> = name
        .split(|c: char| c == '-' || c == '_' || c.is_whitespace())
        .filter(|t| !t.is_empty())
        .collect();

    while tokens.len() > 1 {
        let last = tokens[tokens.len() - 1].to_lowercase();
        if PLATFORM_SUFFIXES.contains(&last.as_str()) {
            tokens.pop();
        } else {
            break;
        }
    }

    let version_at = tokens.iter().rposition(|t| is_version_token(t));
    let version = version_at.map(|i| strip_version_prefix(tokens[i]).to_string());

    let without_version: Vec<&str> = tokens
        .iter()
        .enumerate()
        .filter(|(i, _)| Some(*i) != version_at)
        .map(|(_, t)| *t)
        .collect();
    let name_tokens = if without_version.is_empty() { tokens.clone() } else { without_version };

    let title = name_tokens
        .iter()
        .map(|t| split_camel(t))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    let base = normalize_base(&name_tokens.join(""));

    ParsedFolder {
        base_name: if base.is_empty() { name.trim().to_lowercase() } else { base },
        title: if title.is_empty() { name.trim().to_string() } else { title },
        version,
    }
}

pub fn normalize_base(raw: &str) -> String {
    raw.chars()
        .flat_map(|c| c.to_lowercase())
        .filter(|c| c.is_alphanumeric())
        .collect()
}

pub fn looks_like_version(raw: &str) -> bool {
    let trimmed = raw.trim();
    !trimmed.is_empty()
        && trimmed.starts_with(|c: char| c.is_ascii_digit())
        && trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

pub fn split_camel(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    let mut out = String::with_capacity(token.len() + 4);
    for (i, c) in chars.iter().enumerate() {
        let prev = if i == 0 { None } else { Some(chars[i - 1]) };
        let next = chars.get(i + 1).copied();
        let boundary = match (prev, next) {
            (Some(p), _) if c.is_uppercase() && p.is_lowercase() => true,
            (Some(p), Some(n)) if c.is_uppercase() && p.is_uppercase() && n.is_lowercase() => true,
            (Some(p), _) if c.is_numeric() && p.is_alphabetic() => true,
            _ => false,
        };
        if boundary {
            out.push(' ');
        }
        out.push(*c);
    }
    out
}

fn strip_version_prefix(token: &str) -> &str {
    let trimmed = token.trim();
    let mut chars = trimmed.chars();
    match chars.next() {
        Some(c) if c == 'v' || c == 'V' => {
            let rest = chars.as_str();
            if rest.starts_with(|c: char| c.is_ascii_digit()) {
                rest
            } else {
                trimmed
            }
        }
        _ => trimmed,
    }
}

pub fn is_version_token(token: &str) -> bool {
    let candidate = strip_version_prefix(token);
    if !candidate.starts_with(|c: char| c.is_ascii_digit()) {
        return false;
    }
    if !candidate
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.')
    {
        return false;
    }
    candidate.contains('.') || candidate.len() != token.trim().len()
}

pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let mut left = a.split('.');
    let mut right = b.split('.');
    loop {
        match (left.next(), right.next()) {
            (None, None) => return Ordering::Equal,
            (Some(l), None) => {
                if segment_is_zero(l) {
                    continue;
                }
                return Ordering::Greater;
            }
            (None, Some(r)) => {
                if segment_is_zero(r) {
                    continue;
                }
                return Ordering::Less;
            }
            (Some(l), Some(r)) => match compare_segment(l, r) {
                Ordering::Equal => continue,
                other => return other,
            },
        }
    }
}

fn segment_is_zero(segment: &str) -> bool {
    let (num, rest) = split_segment(segment);
    num == 0 && rest.is_empty()
}

fn compare_segment(l: &str, r: &str) -> Ordering {
    let (ln, lrest) = split_segment(l);
    let (rn, rrest) = split_segment(r);
    match ln.cmp(&rn) {
        Ordering::Equal => lrest.cmp(rrest),
        other => other,
    }
}

fn split_segment(segment: &str) -> (u64, &str) {
    let digits: String = segment.chars().take_while(|c| c.is_ascii_digit()).collect();
    let rest = &segment[digits.len()..];
    let number = if digits.is_empty() { 0 } else { digits.parse().unwrap_or(u64::MAX) };
    (number, rest)
}

pub fn pick_exe(candidates: &[ExeCandidate], base_name: &str) -> Option<String> {
    let usable: Vec<&ExeCandidate> = candidates
        .iter()
        .filter(|c| !is_helper_exe(&c.path))
        .collect();
    if usable.is_empty() {
        return None;
    }

    let mut depths: Vec<u8> = usable.iter().map(|c| c.depth).collect();
    depths.sort_unstable();
    depths.dedup();

    for depth in depths {
        let level: Vec<&&ExeCandidate> = usable.iter().filter(|c| c.depth == depth).collect();
        if level.is_empty() {
            continue;
        }
        if let Some(hit) = level
            .iter()
            .find(|c| normalize_base(file_stem(&c.path)) == base_name)
        {
            return Some(hit.path.clone());
        }
        if level.len() == 1 {
            return Some(level[0].path.clone());
        }
        if let Some(hit) = level
            .iter()
            .find(|c| base_name.starts_with(&normalize_base(file_stem(&c.path))) && !file_stem(&c.path).is_empty())
        {
            return Some(hit.path.clone());
        }
        let biggest = level.iter().max_by_key(|c| c.size)?;
        return Some(biggest.path.clone());
    }
    None
}

fn file_stem(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.rfind('.') {
        Some(dot) => &name[..dot],
        None => name,
    }
}

fn is_helper_exe(path: &str) -> bool {
    let stem = file_stem(path).to_lowercase();
    EXE_SKIP_PARTS.iter().any(|part| {
        if stem == *part {
            return true;
        }
        let Some(tail) = stem.strip_prefix(part) else {
            return false;
        };
        !tail.starts_with(|c: char| c.is_alphabetic())
    })
}

pub fn version_in_brackets(title: &str) -> Option<String> {
    let mut rest = title;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let close = after.find(']')?;
        let inner = after[..close].trim();
        if is_version_token(inner) {
            return Some(strip_version_prefix(inner).to_string());
        }
        rest = &after[close + 1..];
    }
    None
}

pub fn f95_version_from_html(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    for selector in ["title", "h1.p-title-value"] {
        let Ok(sel) = Selector::parse(selector) else {
            continue;
        };
        if let Some(text) = document.select(&sel).next() {
            let joined = text.text().collect::<String>();
            if let Some(version) = version_in_brackets(&joined) {
                return Some(version);
            }
        }
    }
    None
}

pub fn itch_updated_from_html(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let row = Selector::parse("tr").ok()?;
    let cell = Selector::parse("td").ok()?;
    let abbr = Selector::parse("abbr").ok()?;
    for tr in document.select(&row) {
        let mut cells = tr.select(&cell);
        let Some(first) = cells.next() else {
            continue;
        };
        if first.text().collect::<String>().trim() != "Updated" {
            continue;
        }
        if let Some(stamp) = tr.select(&abbr).next().and_then(|a| a.value().attr("title")) {
            return parse_itch_stamp(stamp);
        }
    }
    None
}

pub fn itch_updated_from_devlog(rss: &str) -> Option<String> {
    let items = rss.find("<item>").or_else(|| rss.find("<item "))?;
    let tail = &rss[items..];
    let open = tail.find("<pubDate>")? + "<pubDate>".len();
    let close = tail[open..].find("</pubDate>")? + open;
    parse_rfc822_stamp(tail[open..close].trim())
}

pub fn parse_itch_stamp(stamp: &str) -> Option<String> {
    let cleaned = stamp.replace('@', " ");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let day: u32 = parts[0].parse().ok()?;
    let month = month_number(parts[1])?;
    let year: i32 = parts[2].parse().ok()?;
    format_stamp(year, month, day, clock_of(&parts[3..]))
}

pub fn parse_rfc822_stamp(stamp: &str) -> Option<String> {
    let parts: Vec<&str> = stamp.split_whitespace().collect();
    let offset = usize::from(!parts.first()?.starts_with(|c: char| c.is_ascii_digit()));
    let day: u32 = parts.get(offset)?.parse().ok()?;
    let month = month_number(parts.get(offset + 1)?)?;
    let year: i32 = parts.get(offset + 2)?.parse().ok()?;
    format_stamp(year, month, day, clock_of(&parts[(offset + 3).min(parts.len())..]))
}

fn clock_of<'a>(rest: &[&'a str]) -> Option<&'a str> {
    rest.iter().copied().find(|part| part.contains(':'))
}

fn format_stamp(year: i32, month: u32, day: u32, time: Option<&str>) -> Option<String> {
    if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
        return None;
    }
    let mut clock = time.unwrap_or("00:00").split(':');
    let hour: u32 = clock.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let minute: u32 = clock.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    if hour > 23 || minute > 59 {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}Z"))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn month_number(raw: &str) -> Option<u32> {
    let lower = raw.to_lowercase();
    if lower.len() < 3 {
        return None;
    }
    MONTHS
        .iter()
        .find(|(name, _)| lower.starts_with(name))
        .map(|(_, number)| *number)
}

pub fn source_from_url(raw: &str) -> Option<Source> {
    let parsed = url::Url::parse(raw.trim()).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    if host == "f95zone.to" || host.ends_with(".f95zone.to") {
        return Some(Source::F95);
    }
    if host == "itch.io" || host.ends_with(".itch.io") {
        return Some(Source::Itch);
    }
    None
}

pub fn f95_thread_id(raw: &str) -> Option<String> {
    let parsed = url::Url::parse(raw.trim()).ok()?;
    let mut segments = parsed.path_segments()?;
    segments.find(|s| *s == "threads")?;
    let slug = segments.next()?;
    let tail = slug.rsplit('.').next()?;
    if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
        Some(tail.to_string())
    } else {
        None
    }
}

pub fn has_update(
    source: Source,
    installed: Option<&str>,
    site: Option<&str>,
    seen: Option<&str>,
    skipped: Option<&str>,
) -> bool {
    let Some(site) = site.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    if skipped
        .map(|s| s.trim().to_lowercase())
        .is_some_and(|s| s == site.to_lowercase())
    {
        return false;
    }
    match source {
        Source::F95 => {
            if !looks_like_version(site) {
                return false;
            }
            let Some(installed) = installed.map(str::trim).filter(|s| !s.is_empty()) else {
                return true;
            };
            if !looks_like_version(installed) {
                return site != installed;
            }
            compare_versions(site, installed) == Ordering::Greater
        }
        Source::Itch => {
            let Some(seen) = seen.map(str::trim).filter(|s| !s.is_empty()) else {
                return false;
            };
            site > seen
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_folder_with_version_and_platform_suffix() {
        let parsed = parse_folder_name("PathOfDesire-0.5.2-pc");
        assert_eq!(parsed.title, "Path Of Desire");
        assert_eq!(parsed.base_name, "pathofdesire");
        assert_eq!(parsed.version.as_deref(), Some("0.5.2"));
    }

    #[test]
    fn parses_version_with_letter_revision() {
        let parsed = parse_folder_name("AHouseInTheRift-0.8.12r1-pc");
        assert_eq!(parsed.title, "A House In The Rift");
        assert_eq!(parsed.base_name, "ahouseintherift");
        assert_eq!(parsed.version.as_deref(), Some("0.8.12r1"));
    }

    #[test]
    fn parses_folder_without_version() {
        let parsed = parse_folder_name("Summer_Memories");
        assert_eq!(parsed.title, "Summer Memories");
        assert_eq!(parsed.base_name, "summermemories");
        assert_eq!(parsed.version, None);
    }

    #[test]
    fn parses_cyrillic_folder() {
        let parsed = parse_folder_name("Тайна Особняка-1.2-pc");
        assert_eq!(parsed.title, "Тайна Особняка");
        assert_eq!(parsed.base_name, "тайнаособняка");
        assert_eq!(parsed.version.as_deref(), Some("1.2"));
    }

    #[test]
    fn keeps_name_when_version_leads() {
        let parsed = parse_folder_name("7Days-pc");
        assert_eq!(parsed.base_name, "7days");
        assert_eq!(parsed.version, None);
    }

    #[test]
    fn renamed_folder_keeps_same_base_name() {
        let before = parse_folder_name("PathOfDesire-0.5.2-pc");
        let after = parse_folder_name("PathOfDesire-0.6.0-pc");
        assert_eq!(before.base_name, after.base_name);
        assert_ne!(before.version, after.version);
    }

    #[test]
    fn platform_word_alone_stays_in_name() {
        let parsed = parse_folder_name("Windows");
        assert_eq!(parsed.base_name, "windows");
    }

    #[test]
    fn version_in_the_middle_keeps_the_tail_of_the_name() {
        let parsed = parse_folder_name("Game-0.5-Extra-pc");
        assert_eq!(parsed.base_name, "gameextra");
        assert_eq!(parsed.version.as_deref(), Some("0.5"));
        assert_ne!(parse_folder_name("Game-0.6-Something-pc").base_name, parsed.base_name);
    }

    #[test]
    fn version_at_the_front_does_not_drift_base_name() {
        let old = parse_folder_name("v0.5-SomeGame-pc");
        let new = parse_folder_name("v0.6-SomeGame-pc");
        assert_eq!(old.base_name, "somegame");
        assert_eq!(old.base_name, new.base_name);
        assert_eq!(new.version.as_deref(), Some("0.6"));
    }

    #[test]
    fn symbol_only_names_stay_distinct() {
        assert_eq!(parse_folder_name("---").base_name, "---");
        assert_eq!(parse_folder_name("🎮🎮").base_name, "🎮🎮");
        assert_ne!(parse_folder_name("---").base_name, parse_folder_name("🎮🎮").base_name);
    }

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(compare_versions("0.10.0", "0.9.0"), Ordering::Greater);
        assert_eq!(compare_versions("0.5.2", "0.5.2"), Ordering::Equal);
        assert_eq!(compare_versions("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.8.12r1", "0.8.12"), Ordering::Greater);
        assert_eq!(compare_versions("0.5.2", "0.6.0"), Ordering::Less);
    }

    #[test]
    fn huge_version_number_does_not_wrap_to_zero() {
        assert_eq!(
            compare_versions("99999999999999999999.0", "1.0"),
            Ordering::Greater
        );
    }

    #[test]
    fn picks_game_exe_over_helpers() {
        let candidates = vec![
            ExeCandidate { path: "unins000.exe".into(), size: 3_000_000, depth: 0 },
            ExeCandidate { path: "vcredist_x64.exe".into(), size: 9_000_000, depth: 0 },
            ExeCandidate { path: "PathOfDesire.exe".into(), size: 1_000_000, depth: 0 },
        ];
        assert_eq!(pick_exe(&candidates, "pathofdesire").as_deref(), Some("PathOfDesire.exe"));
    }

    #[test]
    fn picks_biggest_when_names_do_not_match() {
        let candidates = vec![
            ExeCandidate { path: "start.exe".into(), size: 1_000, depth: 0 },
            ExeCandidate { path: "game.exe".into(), size: 50_000, depth: 0 },
        ];
        assert_eq!(pick_exe(&candidates, "someother").as_deref(), Some("game.exe"));
    }

    #[test]
    fn falls_back_to_nested_exe() {
        let candidates = vec![
            ExeCandidate { path: "unins000.exe".into(), size: 3_000_000, depth: 0 },
            ExeCandidate { path: "game/Game.exe".into(), size: 10_000, depth: 1 },
        ];
        assert_eq!(pick_exe(&candidates, "game").as_deref(), Some("game/Game.exe"));
    }

    #[test]
    fn keeps_games_whose_name_starts_like_a_helper() {
        let candidates = vec![ExeCandidate {
            path: "PythonicDreams.exe".into(),
            size: 5_000,
            depth: 0,
        }];
        assert_eq!(
            pick_exe(&candidates, "pythonicdreams").as_deref(),
            Some("PythonicDreams.exe")
        );
        let installment = vec![ExeCandidate { path: "Installment.exe".into(), size: 5_000, depth: 0 }];
        assert_eq!(pick_exe(&installment, "installment").as_deref(), Some("Installment.exe"));
        let helper = vec![ExeCandidate { path: "python3.exe".into(), size: 5_000, depth: 0 }];
        assert_eq!(pick_exe(&helper, "whatever"), None);
    }

    #[test]
    fn reaches_exe_deeper_than_one_level() {
        let candidates = vec![ExeCandidate {
            path: "data/bin/Game.exe".into(),
            size: 5_000,
            depth: 2,
        }];
        assert_eq!(pick_exe(&candidates, "game").as_deref(), Some("data/bin/Game.exe"));
    }

    #[test]
    fn returns_none_when_only_helpers() {
        let candidates = vec![ExeCandidate {
            path: "unins000.exe".into(),
            size: 10,
            depth: 0,
        }];
        assert_eq!(pick_exe(&candidates, "game"), None);
    }

    #[test]
    fn reads_version_from_f95_title() {
        let html = "<html><head><title>RPGM - Dicky Lucky [v0.02b] [wowidol999] | F95zone</title></head><body></body></html>";
        assert_eq!(f95_version_from_html(html).as_deref(), Some("0.02b"));
    }

    #[test]
    fn reads_version_from_f95_heading_when_title_missing() {
        let html = "<html><body><h1 class=\"p-title-value\">Ren'Py Path Of Desire [v0.6.0] [dev]</h1></body></html>";
        assert_eq!(f95_version_from_html(html).as_deref(), Some("0.6.0"));
    }

    #[test]
    fn ignores_non_version_brackets() {
        assert_eq!(version_in_brackets("Game [RPGM] [wowidol999]"), None);
        assert_eq!(version_in_brackets("Game [Completed] [1.0]").as_deref(), Some("1.0"));
    }

    #[test]
    fn reads_updated_stamp_from_itch_page() {
        let html = "<html><body><table><tr><td>Updated</td><td><abbr title=\"04 September 2026 @ 14:11 UTC\">4 days ago</abbr></td></tr></table></body></html>";
        assert_eq!(itch_updated_from_html(html).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn reads_updated_stamp_from_devlog() {
        let rss = "<rss><channel><item><pubDate>Thu, 04 Sep 2026 14:11:00 GMT</pubDate></item></channel></rss>";
        assert_eq!(itch_updated_from_devlog(rss).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn skips_table_rows_without_cells_before_updated() {
        let html = "<html><body><table><tr><th colspan=\"2\">More information</th></tr><tr><td>Published</td><td>x</td></tr><tr><td>Updated</td><td><abbr title=\"04 September 2026 @ 14:11 UTC\">4 days ago</abbr></td></tr></table></body></html>";
        assert_eq!(itch_updated_from_html(html).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn devlog_ignores_channel_level_pub_date() {
        let rss = "<rss><channel><pubDate>Mon, 01 Jan 2020 00:00:00 GMT</pubDate><item><pubDate>Thu, 04 Sep 2026 14:11:00 GMT</pubDate></item></channel></rss>";
        assert_eq!(itch_updated_from_devlog(rss).as_deref(), Some("2026-09-04T14:11Z"));
    }

    #[test]
    fn stamps_without_time_or_comma_still_parse() {
        assert_eq!(parse_itch_stamp("04 September 2026").as_deref(), Some("2026-09-04T00:00Z"));
        assert_eq!(parse_itch_stamp("04 September 2026 UTC").as_deref(), Some("2026-09-04T00:00Z"));
        assert_eq!(
            parse_rfc822_stamp("04 Sep 2026 14:11:00 GMT").as_deref(),
            Some("2026-09-04T14:11Z")
        );
    }

    #[test]
    fn impossible_dates_are_rejected() {
        assert_eq!(parse_itch_stamp("31 February 2026 @ 10:00 UTC"), None);
        assert_eq!(parse_itch_stamp("04 September 2026 @ 26:00 UTC"), None);
        assert_eq!(parse_itch_stamp("29 February 2024 @ 10:00 UTC").as_deref(), Some("2024-02-29T10:00Z"));
        assert_eq!(parse_itch_stamp("не дата"), None);
    }

    #[test]
    fn detects_source_from_url() {
        assert_eq!(source_from_url("https://f95zone.to/threads/313900/"), Some(Source::F95));
        assert_eq!(source_from_url("https://zanithone.itch.io/a-house-in-the-rift"), Some(Source::Itch));
        assert_eq!(source_from_url("https://example.com/game"), None);
        assert_eq!(source_from_url("не ссылка"), None);
    }

    #[test]
    fn reads_thread_id_from_slug_and_plain_url() {
        assert_eq!(
            f95_thread_id("https://f95zone.to/threads/dicky-lucky-v0-02b-wowidol999.313900/").as_deref(),
            Some("313900")
        );
        assert_eq!(
            f95_thread_id("https://f95zone.to/threads/313900/").as_deref(),
            Some("313900")
        );
        assert_eq!(f95_thread_id("https://f95zone.to/latest"), None);
    }

    #[test]
    fn update_shows_when_site_version_is_newer() {
        assert!(has_update(Source::F95, Some("0.5.2"), Some("0.6.0"), None, None));
        assert!(!has_update(Source::F95, Some("0.6.0"), Some("0.6.0"), None, None));
        assert!(!has_update(Source::F95, Some("0.6.0"), Some("0.5.2"), None, None));
    }

    #[test]
    fn skipped_version_hides_update_until_newer_one() {
        assert!(!has_update(Source::F95, Some("0.5.2"), Some("0.6.0"), None, Some("0.6.0")));
        assert!(has_update(Source::F95, Some("0.5.2"), Some("0.7.0"), None, Some("0.6.0")));
    }

    #[test]
    fn unknown_installed_version_counts_as_update() {
        assert!(has_update(Source::F95, None, Some("0.6.0"), None, None));
        assert!(!has_update(Source::F95, None, None, None, None));
    }

    #[test]
    fn garbage_site_version_does_not_raise_a_badge() {
        assert!(!has_update(Source::F95, Some("0.5.2"), Some("Unknown"), None, None));
        assert!(!has_update(Source::F95, None, Some("Unknown"), None, None));
    }

    #[test]
    fn skipped_version_matches_regardless_of_case() {
        assert!(!has_update(
            Source::F95,
            Some("0.8.12"),
            Some("0.8.12r1"),
            None,
            Some("0.8.12R1")
        ));
    }

    #[test]
    fn itch_update_compares_stamps() {
        assert!(has_update(
            Source::Itch,
            None,
            Some("2026-09-04T14:11Z"),
            Some("2026-08-01T10:00Z"),
            None
        ));
        assert!(!has_update(
            Source::Itch,
            None,
            Some("2026-09-04T14:11Z"),
            Some("2026-09-04T14:11Z"),
            None
        ));
        assert!(!has_update(
            Source::Itch,
            None,
            Some("2026-09-04T14:11Z"),
            Some("2026-08-01T10:00Z"),
            Some("2026-09-04T14:11Z")
        ));
    }
}
