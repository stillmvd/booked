const JUNK: &[&str] = &["__MACOSX", ".DS_Store", "Thumbs.db", "desktop.ini"];
const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1",
    "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];
const LOOSE_DOCS: &[&str] = &["txt", "md", "url", "pdf", "nfo", "html", "htm", "rtf"];
pub const FALLBACK_NAME: &str = "Игра";

fn parts(path: &str) -> impl Iterator<Item = &str> {
    path.split(['/', '\\']).filter(|part| !part.is_empty())
}

pub fn is_junk(path: &str) -> bool {
    parts(path).any(|part| JUNK.iter().any(|junk| junk.eq_ignore_ascii_case(part)))
}

fn is_loose_doc(path: &str) -> bool {
    let mut split = parts(path);
    let (Some(name), None) = (split.next(), split.next()) else {
        return false;
    };
    !path.ends_with(['/', '\\'])
        && name
            .rsplit_once('.')
            .is_some_and(|(_, ext)| LOOSE_DOCS.iter().any(|doc| doc.eq_ignore_ascii_case(ext)))
}

pub fn shared_top(paths: &[String]) -> Option<String> {
    let mut top: Option<&str> = None;
    for path in paths.iter().filter(|path| !is_junk(path) && !is_loose_doc(path)) {
        let mut split = parts(path);
        let head = split.next()?;
        let nested = split.next().is_some() || path.ends_with(['/', '\\']);
        if !nested {
            return None;
        }
        match top {
            None => top = Some(head),
            Some(known) if known == head => {}
            Some(_) => return None,
        }
    }
    top.map(str::to_string)
}

pub fn inner_path(path: &str, top: Option<&str>) -> Option<String> {
    let mut split = parts(path).peekable();
    if let Some(top) = top {
        if is_loose_doc(path) {
            return parts(path).next().map(str::to_string);
        }
        if split.next() != Some(top) {
            return None;
        }
    }
    let rest: Vec<&str> = split.collect();
    if rest.is_empty() || rest.iter().any(|part| *part == ".." || *part == ".") {
        return None;
    }
    Some(rest.join("/"))
}

pub fn archive_stem(file_name: &str) -> &str {
    match file_name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && ["zip", "rar", "7z"].iter().any(|known| known.eq_ignore_ascii_case(ext)) => {
            stem
        }
        _ => file_name,
    }
}

pub fn safe_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = joined.trim_start_matches('.').trim_end_matches(['.', ' ']).trim().to_string();
    if trimmed.is_empty() {
        return FALLBACK_NAME.to_string();
    }
    let stem = trimmed.split('.').next().unwrap_or_default().to_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        return format!("{trimmed}_");
    }
    trimmed
}

pub fn free_name(wanted: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(wanted) {
        return wanted.to_string();
    }
    (2..)
        .map(|n| format!("{wanted} ({n})"))
        .find(|candidate| !taken(candidate))
        .unwrap_or_else(|| wanted.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn archive_with_one_folder_keeps_its_name() {
        let paths = list(&[
            "TheRuinedBloomv0.6.2-0.6.2-pc/",
            "TheRuinedBloomv0.6.2-0.6.2-pc/game/script.rpa",
            "TheRuinedBloomv0.6.2-0.6.2-pc/TheRuinedBloomv0.6.2.exe",
        ]);
        assert_eq!(shared_top(&paths).as_deref(), Some("TheRuinedBloomv0.6.2-0.6.2-pc"));
    }

    #[test]
    fn folder_without_own_entry_still_counts() {
        let paths = list(&["Игра-1.0/game.exe", "Игра-1.0/data/a.bin"]);
        assert_eq!(shared_top(&paths).as_deref(), Some("Игра-1.0"));
    }

    #[test]
    fn flat_archive_has_no_top() {
        assert_eq!(shared_top(&list(&["game.exe", "data/a.bin"])), None);
        assert_eq!(shared_top(&list(&["Game/game.exe", "Other/a.bin"])), None);
        assert_eq!(shared_top(&list(&["Game/game.exe", "notes.bin"])), None);
        assert_eq!(shared_top(&[]), None);
    }

    #[test]
    fn readme_beside_single_folder_goes_inside() {
        let paths = list(&[
            "Bug Huntress Wants to Battle!_v1.7/",
            "Bug Huntress Wants to Battle!_v1.7/MonsterBattle.exe",
            "ReadMe.txt",
            "遊び方.txt",
        ]);
        let top = shared_top(&paths);
        assert_eq!(top.as_deref(), Some("Bug Huntress Wants to Battle!_v1.7"));
        assert_eq!(inner_path("ReadMe.txt", top.as_deref()).as_deref(), Some("ReadMe.txt"));
        assert_eq!(inner_path("遊び方.txt", top.as_deref()).as_deref(), Some("遊び方.txt"));
        assert_eq!(shared_top(&list(&["Game/game.exe", "UnityPlayer.dll"])), None);
        assert_eq!(shared_top(&list(&["Game_Data/a.bin", "Game.exe", "readme.txt"])), None);
    }

    #[test]
    fn mac_junk_does_not_break_single_folder() {
        let paths = list(&["Game/game.exe", "__MACOSX/Game/._game.exe", ".DS_Store", "Game/Thumbs.db"]);
        assert_eq!(shared_top(&paths).as_deref(), Some("Game"));
        assert!(is_junk("__MACOSX/Game/._game.exe"));
        assert!(is_junk("Game/Thumbs.db"));
        assert!(!is_junk("Game/game.exe"));
    }

    #[test]
    fn inner_path_strips_top_folder() {
        assert_eq!(inner_path("Game/data/a.bin", Some("Game")).as_deref(), Some("data/a.bin"));
        assert_eq!(inner_path("Game/", Some("Game")), None);
        assert_eq!(inner_path("Other/a.bin", Some("Game")), None);
        assert_eq!(inner_path("data/a.bin", None).as_deref(), Some("data/a.bin"));
        assert_eq!(inner_path("Game/../evil.dll", Some("Game")), None);
        assert_eq!(inner_path("Game/a/b/../../../x", Some("Game")), None);
        assert_eq!(inner_path("./x", None), None);
        assert_eq!(inner_path("data\\a.bin", None).as_deref(), Some("data/a.bin"));
    }

    #[test]
    fn stem_drops_zip_in_any_case() {
        assert_eq!(archive_stem("TheRuinedBloomv0.6.2-pc.zip"), "TheRuinedBloomv0.6.2-pc");
        assert_eq!(archive_stem("Игра.ZIP"), "Игра");
        assert_eq!(archive_stem("Игра"), "Игра");
        assert_eq!(archive_stem("Apocalypse_with_Femboy_v1.0.rar"), "Apocalypse_with_Femboy_v1.0");
        assert_eq!(archive_stem("Game-1.2.7z"), "Game-1.2");
        assert_eq!(archive_stem("Game-1.2"), "Game-1.2");
    }

    #[test]
    fn safe_name_cleans_windows_forbidden() {
        assert_eq!(safe_name("Игра: Часть 2?"), "Игра Часть 2");
        assert_eq!(safe_name("  Name.. "), "Name");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name("CON"), "CON_");
        assert_eq!(safe_name("nul.txt"), "nul.txt_");
        assert_eq!(safe_name("???"), FALLBACK_NAME);
    }

    #[test]
    fn free_name_adds_counter() {
        let taken = ["Игра", "Игра (2)"];
        assert_eq!(free_name("Игра", |name| taken.contains(&name)), "Игра (3)");
        assert_eq!(free_name("Другая", |name| taken.contains(&name)), "Другая");
    }
}
