use url::Url;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct HostAction {
    pub direct_thumb: Option<Url>,
    pub meta_url: Option<Url>,
}

fn is_valid_video_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn youtube_id(url: &Url) -> Option<String> {
    let host = url.host_str()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);

    let raw = match host {
        "youtube.com" => {
            if url.path() != "/watch" {
                return None;
            }
            url.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.into_owned())?
        }
        "youtu.be" => url.path_segments()?.next()?.to_string(),
        _ => return None,
    };

    is_valid_video_id(&raw).then_some(raw)
}

fn youtube_action(url: &Url) -> Option<HostAction> {
    let id = youtube_id(url)?;
    let thumb = Url::parse(&format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")).ok()?;
    Some(HostAction { direct_thumb: Some(thumb), meta_url: None })
}

fn reddit_action(url: &Url) -> Option<HostAction> {
    let host = url.host_str()?.to_ascii_lowercase();
    if host != "reddit.com" && host != "www.reddit.com" {
        return None;
    }
    let mut meta_url = url.clone();
    meta_url.set_host(Some("old.reddit.com")).ok()?;
    Some(HostAction { direct_thumb: None, meta_url: Some(meta_url) })
}

type RuleFn = fn(&Url) -> Option<HostAction>;

pub const RULES: &[RuleFn] = &[youtube_action, reddit_action];

pub fn apply(url: &Url) -> HostAction {
    RULES.iter().find_map(|rule| rule(url)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_watch_url_gives_thumbnail_without_fetching_page() {
        let url = Url::parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap();
        let action = apply(&url);
        assert_eq!(
            action.direct_thumb.unwrap().as_str(),
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
        );
        assert!(action.meta_url.is_none());
    }

    #[test]
    fn youtube_short_url_gives_same_thumbnail() {
        let url = Url::parse("https://youtu.be/dQw4w9WgXcQ").unwrap();
        let action = apply(&url);
        assert_eq!(
            action.direct_thumb.unwrap().as_str(),
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
        );
    }

    #[test]
    fn youtube_channel_home_has_no_rule() {
        let url = Url::parse("https://www.youtube.com/@somechannel").unwrap();
        let action = apply(&url);
        assert!(action.direct_thumb.is_none());
        assert!(action.meta_url.is_none());
    }

    #[test]
    fn youtube_id_with_invalid_characters_rejected() {
        let url = Url::parse("https://www.youtube.com/watch?v=abc/../evil").unwrap();
        assert!(youtube_id(&url).is_none());
    }

    #[test]
    fn reddit_www_rewritten_to_old_domain_preserving_path_query_fragment() {
        let url = Url::parse("https://www.reddit.com/r/rust/?sort=top#comments").unwrap();
        let action = apply(&url);
        let meta = action.meta_url.unwrap();
        assert_eq!(meta.as_str(), "https://old.reddit.com/r/rust/?sort=top#comments");
        assert!(action.direct_thumb.is_none());
    }

    #[test]
    fn reddit_old_domain_gets_no_rule() {
        let url = Url::parse("https://old.reddit.com/r/rust/").unwrap();
        let action = apply(&url);
        assert!(action.meta_url.is_none());
        assert!(action.direct_thumb.is_none());
    }

    #[test]
    fn unmatched_host_gets_empty_action() {
        let url = Url::parse("https://example.test/page").unwrap();
        let action = apply(&url);
        assert_eq!(action, HostAction::default());
    }

    #[test]
    fn rule_matches_host_with_or_without_www() {
        let bare = Url::parse("https://reddit.com/r/rust/").unwrap();
        let www = Url::parse("https://www.reddit.com/r/rust/").unwrap();
        assert_eq!(apply(&bare).meta_url.unwrap().host_str(), Some("old.reddit.com"));
        assert_eq!(apply(&www).meta_url.unwrap().host_str(), Some("old.reddit.com"));
    }

    #[test]
    fn host_action_has_exactly_two_fields() {
        let action = HostAction { direct_thumb: None, meta_url: None };
        assert!(action.direct_thumb.is_none() && action.meta_url.is_none());
    }

    #[test]
    fn rules_array_has_exactly_two_entries() {
        assert_eq!(RULES.len(), 2);
    }
}
