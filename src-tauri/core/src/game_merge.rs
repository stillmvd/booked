use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::games::{self, parse_folder_name, Source};

const COMMON_EXE: &[&str] = &[
    "game",
    "games",
    "game32",
    "game64",
    "gamex64",
    "gamex86",
    "start",
    "launcher",
    "launch",
    "play",
    "run",
    "main",
    "app",
    "application",
    "program",
    "nw",
    "rpgrt",
    "client",
    "player",
    "index",
    "windows",
    "win",
    "win32",
    "win64",
    "x64",
    "x86",
    "игра",
    "игры",
    "запуск",
    "пуск",
    "старт",
    "лаунчер",
    "плеер",
];

#[derive(Debug, Clone, Default)]
pub struct PairCard {
    pub id: i64,
    pub created_at: i64,
    pub base_name: String,
    pub folder_name: Option<String>,
    pub has_folder: bool,
    pub page_url: Option<String>,
    pub exe_path: Option<String>,
    pub engine: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReasons {
    pub name: bool,
    pub page: Option<Source>,
    pub exe: Option<String>,
    pub engine: Option<String>,
}

impl MatchReasons {
    pub fn any(&self) -> bool {
        self.name || self.page.is_some() || self.exe.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionGroup {
    pub ids: Vec<i64>,
    pub reasons: MatchReasons,
}

pub fn ordered(a: i64, b: i64) -> (i64, i64) {
    (a.min(b), a.max(b))
}

pub fn name_key(base_name: &str) -> &str {
    match base_name.rsplit_once('#') {
        Some((head, tail))
            if !head.is_empty() && !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) =>
        {
            head
        }
        _ => base_name,
    }
}

fn name_keys(card: &PairCard) -> Vec<String> {
    let mut keys = vec![name_key(&card.base_name).to_string()];
    if let Some(folder) = card.folder_name.as_deref() {
        let parsed = parse_folder_name(folder).base_name;
        if !keys.contains(&parsed) {
            keys.push(parsed);
        }
    }
    keys
}

pub fn exe_file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

pub fn exe_key(path: &str) -> Option<String> {
    let name = exe_file_name(path.trim());
    let stem = match name.rsplit_once('.') {
        Some((stem, ext)) if ext.eq_ignore_ascii_case("exe") => stem,
        _ => name,
    };
    let key = parse_folder_name(stem).base_name;
    (key.chars().count() >= 3 && !COMMON_EXE.contains(&key.as_str())).then_some(key)
}

pub fn page_key(raw: &str) -> Option<(Source, String)> {
    match games::source_from_url(raw)? {
        Source::F95 => games::f95_thread_id(raw).map(|id| (Source::F95, id)),
        Source::Itch => {
            let parsed = url::Url::parse(raw.trim()).ok()?;
            let host = parsed.host_str()?.to_lowercase();
            if host == "itch.io" {
                return None;
            }
            let slug = parsed.path_segments()?.find(|s| !s.is_empty())?.to_lowercase();
            Some((Source::Itch, format!("{host}/{slug}")))
        }
    }
}

fn known_engine(card: &PairCard) -> Option<&str> {
    card.engine
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty() && *e != games::ENGINE_UNKNOWN)
}

pub fn match_reasons(a: &PairCard, b: &PairCard) -> Option<MatchReasons> {
    let page_a = a.page_url.as_deref().and_then(page_key);
    let page_b = b.page_url.as_deref().and_then(page_key);
    if let (Some(x), Some(y)) = (&page_a, &page_b) {
        if x != y {
            return None;
        }
    }

    let engine = match (known_engine(a), known_engine(b)) {
        (Some(x), Some(y)) if x == y => Some(x.to_string()),
        _ => None,
    };
    let newer = if (b.created_at, b.id) >= (a.created_at, a.id) { b } else { a };
    let exe = engine.as_ref().and_then(|_| {
        let left = exe_key(a.exe_path.as_deref()?)?;
        let right = exe_key(b.exe_path.as_deref()?)?;
        (left == right).then(|| exe_file_name(newer.exe_path.as_deref().unwrap_or_default()).to_string())
    });
    let keys_b = name_keys(b);

    let reasons = MatchReasons {
        name: name_keys(a).iter().any(|key| keys_b.contains(key)),
        page: page_a.filter(|_| page_b.is_some()).map(|(source, _)| source),
        exe,
        engine,
    };
    reasons.any().then_some(reasons)
}

fn common_reasons(all: &[&MatchReasons]) -> MatchReasons {
    let Some((first, rest)) = all.split_first() else {
        return MatchReasons::default();
    };
    let mut both = (*first).clone();
    for next in rest {
        both.name &= next.name;
        both.page = both.page.filter(|p| next.page == Some(*p));
        both.exe = both.exe.filter(|_| next.exe.is_some());
        both.engine = both.engine.filter(|e| next.engine.as_ref() == Some(e));
    }
    both
}

fn root(parent: &mut [usize], mut at: usize) -> usize {
    while parent[at] != at {
        parent[at] = parent[parent[at]];
        at = parent[at];
    }
    at
}

pub fn find_groups(cards: &[PairCard], distinct: &BTreeSet<(i64, i64)>) -> Vec<VersionGroup> {
    let mut sorted: Vec<&PairCard> = cards.iter().collect();
    sorted.sort_by_key(|card| (card.created_at, card.id));
    let count = sorted.len();

    let mut edges: BTreeMap<(usize, usize), MatchReasons> = BTreeMap::new();
    for i in 0..count {
        for j in i + 1..count {
            let (a, b) = (sorted[i], sorted[j]);
            if !(a.has_folder || b.has_folder) || distinct.contains(&ordered(a.id, b.id)) {
                continue;
            }
            if let Some(reasons) = match_reasons(a, b) {
                edges.insert((i, j), reasons);
            }
        }
    }

    let mut parent: Vec<usize> = (0..count).collect();
    for &(i, j) in edges.keys() {
        let (ri, rj) = (root(&mut parent, i), root(&mut parent, j));
        parent[ri.max(rj)] = ri.min(rj);
    }
    let linked: BTreeSet<usize> = edges.keys().flat_map(|&(i, j)| [i, j]).collect();
    let mut components: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in linked {
        let top = root(&mut parent, i);
        components.entry(top).or_default().push(i);
    }

    let mut found: Vec<(usize, VersionGroup)> = Vec::new();
    for members in components.values() {
        let pairs: Vec<(usize, usize)> = members
            .iter()
            .enumerate()
            .flat_map(|(k, &i)| members[k + 1..].iter().map(move |&j| (i, j)))
            .collect();
        if pairs.iter().all(|pair| edges.contains_key(pair)) {
            let reasons: Vec<&MatchReasons> = pairs.iter().map(|pair| &edges[pair]).collect();
            found.push((
                members[members.len() - 1],
                VersionGroup {
                    ids: members.iter().map(|&i| sorted[i].id).collect(),
                    reasons: common_reasons(&reasons),
                },
            ));
        } else {
            for pair in pairs.iter().filter(|pair| edges.contains_key(pair)) {
                found.push((
                    pair.1,
                    VersionGroup {
                        ids: vec![sorted[pair.0].id, sorted[pair.1].id],
                        reasons: edges[pair].clone(),
                    },
                ));
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, group)| group).collect()
}

pub fn cards(conn: &Connection) -> rusqlite::Result<Vec<PairCard>> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, base_name, folder_name, folder_path IS NOT NULL, page_url, exe_path, engine \
         FROM games",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PairCard {
                id: row.get(0)?,
                created_at: row.get(1)?,
                base_name: row.get(2)?,
                folder_name: row.get(3)?,
                has_folder: row.get(4)?,
                page_url: row.get(5)?,
                exe_path: row.get(6)?,
                engine: row.get(7)?,
            })
        })?
        .collect();
    rows
}

pub fn distinct_marks(conn: &Connection) -> rusqlite::Result<BTreeSet<(i64, i64)>> {
    let mut stmt = conn.prepare("SELECT a_id, b_id FROM game_distinct")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect();
    rows
}

pub fn groups(conn: &Connection) -> rusqlite::Result<Vec<VersionGroup>> {
    Ok(find_groups(&cards(conn)?, &distinct_marks(conn)?))
}

pub fn reasons_for(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Option<MatchReasons>> {
    let all = cards(conn)?;
    let picked: Vec<&PairCard> = ids
        .iter()
        .filter_map(|id| all.iter().find(|card| card.id == *id))
        .collect();
    let mut found = Vec::new();
    for (k, a) in picked.iter().enumerate() {
        for b in &picked[k + 1..] {
            if let Some(reasons) = match_reasons(a, b) {
                found.push(reasons);
            }
        }
    }
    let refs: Vec<&MatchReasons> = found.iter().collect();
    Ok((!refs.is_empty()).then(|| common_reasons(&refs)))
}

pub fn mark_distinct(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for (k, &a) in ids.iter().enumerate() {
        for &b in &ids[k + 1..] {
            if a == b {
                continue;
            }
            let (low, high) = ordered(a, b);
            tx.execute(
                "INSERT OR IGNORE INTO game_distinct (a_id, b_id) VALUES (?1, ?2)",
                params![low, high],
            )?;
        }
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::{sync, ScannedFolder};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn
    }

    fn folder(name: &str) -> ScannedFolder {
        ScannedFolder {
            name: name.to_string(),
            path: format!("E:\\Games\\{name}"),
            size_bytes: Some(1024),
        }
    }

    fn card(id: i64, folder: &str, exe: Option<&str>, engine: Option<&str>) -> PairCard {
        PairCard {
            id,
            created_at: 1_788_944_693 + id,
            base_name: parse_folder_name(folder).base_name,
            folder_name: Some(folder.to_string()),
            has_folder: true,
            page_url: None,
            exe_path: exe.map(String::from),
            engine: engine.map(String::from),
        }
    }

    fn with_page(mut card: PairCard, url: &str) -> PairCard {
        card.page_url = Some(url.to_string());
        card
    }

    fn with_base(mut card: PairCard, base: &str) -> PairCard {
        card.base_name = base.to_string();
        card
    }

    fn ids(groups: &[VersionGroup]) -> Vec<Vec<i64>> {
        groups.iter().map(|g| g.ids.clone()).collect()
    }

    fn none() -> BTreeSet<(i64, i64)> {
        BTreeSet::new()
    }

    fn id_of(conn: &Connection, folder: &str) -> i64 {
        conn.query_row("SELECT id FROM games WHERE folder_name = ?1", params![folder], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn pairs_path_of_desire_by_name_and_exe() {
        let old = with_page(
            card(21, "PathOfDesire-0.5.2-pc", Some("PathOfDesire.exe"), Some("Ren'Py")),
            "https://f95zone.to/threads/path-of-desire-v0-7-0-dev.100000/",
        );
        let new = with_base(
            card(40, "PathOfDesire-0.6.2-pc", Some("PathOfDesire.exe"), Some("Ren'Py")),
            "pathofdesire#2",
        );
        let groups = find_groups(&[new, old], &none());
        assert_eq!(ids(&groups), vec![vec![21, 40]]);
        let reasons = &groups[0].reasons;
        assert!(reasons.name);
        assert_eq!(reasons.exe.as_deref(), Some("PathOfDesire.exe"));
        assert_eq!(reasons.engine.as_deref(), Some("Ren'Py"));
        assert_eq!(reasons.page, None);
    }

    #[test]
    fn pairs_pnc_exe_without_version() {
        assert_eq!(exe_key("PostNutCalamity 0.1.0.exe").as_deref(), Some("postnutcalamity"));
        assert_eq!(exe_key("Post Nut Calamity.exe").as_deref(), Some("postnutcalamity"));
        assert_eq!(exe_key("GenesisProject-v0.4-pc\\GenesisProject.exe").as_deref(), Some("genesisproject"));

        let old = with_page(
            card(22, "PNC 0.1.0 Win", Some("PostNutCalamity 0.1.0.exe"), Some("Unity")),
            "https://f95zone.to/threads/post-nut-calamity-v0-3-1-dev.200000/",
        );
        let new = with_base(card(38, "PNC 0.3.1 Win", Some("Post Nut Calamity.exe"), Some("Unity")), "pnc#2");
        let groups = find_groups(&[old, new], &none());
        assert_eq!(ids(&groups), vec![vec![22, 38]]);
        assert!(groups[0].reasons.name);
        assert_eq!(groups[0].reasons.exe.as_deref(), Some("Post Nut Calamity.exe"));
    }

    #[test]
    fn pairs_renamed_folder_found_by_exe_alone() {
        let old = card(22, "PNC 0.1.0 Win", Some("PostNutCalamity 0.1.0.exe"), Some("Unity"));
        let new = card(41, "Post Nut Calamity v0.4", Some("Post Nut Calamity.exe"), Some("Unity"));
        let groups = find_groups(&[old.clone(), new.clone()], &none());
        assert_eq!(ids(&groups), vec![vec![22, 41]]);
        assert!(!groups[0].reasons.name);

        let other_engine = card(41, "Post Nut Calamity v0.4", Some("Post Nut Calamity.exe"), Some("Ren'Py"));
        assert!(find_groups(&[old, other_engine], &none()).is_empty());
    }

    #[test]
    fn pairs_common_exe_is_not_a_reason() {
        let neighbor = card(
            9,
            "My neighbor is way too perverted! Remake [ver 0.2.4]",
            Some("Game.exe"),
            Some("RPGM"),
        );
        let julia = card(26, "Unmasking_Julia_v.15.0", Some("Game.exe"), Some("RPGM"));
        assert!(find_groups(&[neighbor.clone(), julia.clone()], &none()).is_empty());
        for exe in ["Game.exe", "game/Game.exe", "nw.exe", "RPG_RT.exe", "Launcher.exe", "Game-win64.exe", "Запуск.exe", "Игра 1.2.exe"] {
            assert_eq!(exe_key(exe), None, "{exe}");
        }

        let julia_next = card(50, "Unmasking Julia v.16.0", Some("Game.exe"), Some("RPGM"));
        let found = find_groups(&[julia, julia_next], &none());
        assert_eq!(ids(&found), vec![vec![26, 50]]);
        assert!(found[0].reasons.name);
        assert_eq!(found[0].reasons.exe, None);
    }

    #[test]
    fn pairs_series_and_dlc_are_different_games() {
        let first = card(1, "SummerMemories-1.0-pc", Some("SummerMemories.exe"), Some("Ren'Py"));
        let sequel = card(2, "SummerMemories2-1.0-pc", Some("SummerMemories2.exe"), Some("Ren'Py"));
        let spaced = card(3, "Summer Memories 2", Some("Summer Memories 2.exe"), Some("Ren'Py"));
        let roman = card(4, "Summer Memories II-0.3", Some("SummerMemoriesII.exe"), Some("Ren'Py"));
        let dlc = card(5, "SummerMemories-DLC-1.0-pc", Some("SummerMemoriesDLC.exe"), Some("Ren'Py"));
        for other in [sequel, spaced, roman, dlc] {
            assert!(find_groups(&[first.clone(), other.clone()], &none()).is_empty(), "{:?}", other.folder_name);
        }

        let update = card(6, "SummerMemories-1.1-pc", Some("SummerMemories.exe"), Some("Ren'Py"));
        assert_eq!(ids(&find_groups(&[first, update], &none())), vec![vec![1, 6]]);
    }

    #[test]
    fn pairs_different_pages_veto_the_name() {
        let a = with_page(
            card(1, "Rogue-Like-1.72d-win", None, Some("Ren'Py")),
            "https://f95zone.to/threads/rogue-like-v1-72d.11111/",
        );
        let b = with_page(
            card(2, "RogueLike-0.3-pc", None, Some("Ren'Py")),
            "https://f95zone.to/threads/roguelike-v0-3.22222/",
        );
        assert!(find_groups(&[a.clone(), b], &none()).is_empty());

        let same_thread = with_page(
            card(3, "Something Else", None, None),
            "https://f95zone.to/threads/rogue-like-v1-80.11111/",
        );
        let found = find_groups(&[a, same_thread], &none());
        assert_eq!(ids(&found), vec![vec![1, 3]]);
        assert_eq!(found[0].reasons.page, Some(Source::F95));
        assert!(!found[0].reasons.name);
    }

    #[test]
    fn pairs_itch_address_is_normalized() {
        assert_eq!(
            page_key("https://Zanithone.itch.io/a-house-in-the-rift/devlog?ref=x#top"),
            Some((Source::Itch, "zanithone.itch.io/a-house-in-the-rift".to_string()))
        );
        assert_eq!(page_key("https://zanithone.itch.io/"), None);
        assert_eq!(page_key("https://itch.io/games/free"), None);
        assert_eq!(
            page_key("https://f95zone.to/threads/313900/"),
            Some((Source::F95, "313900".to_string()))
        );
        assert_eq!(page_key("https://f95zone.to/latest"), None);

        let a = with_page(card(1, "AHouseInTheRift-0.8.12r1-pc", None, None), "https://zanithone.itch.io/a-house-in-the-rift");
        let b = with_page(card(2, "AHITR build 9", None, None), "https://zanithone.itch.io/a-house-in-the-rift/");
        assert_eq!(ids(&find_groups(&[a, b], &none())), vec![vec![1, 2]]);
    }

    #[test]
    fn pairs_cyrillic_names() {
        let old = card(1, "Тайна Особняка-1.2-pc", Some("ТайнаОсобняка 1.2.exe"), Some("Ren'Py"));
        let new = card(2, "Тайна Особняка-1.3-pc", Some("Тайна Особняка.exe"), Some("Ren'Py"));
        let sequel = card(3, "Тайна Особняка 2-1.0-pc", Some("Тайна Особняка 2.exe"), Some("Ren'Py"));
        let found = find_groups(&[old, new, sequel], &none());
        assert_eq!(ids(&found), vec![vec![1, 2]]);
        assert!(found[0].reasons.name);
        assert_eq!(found[0].reasons.exe.as_deref(), Some("Тайна Особняка.exe"));
        assert_eq!(name_key("тайнаособняка#2"), "тайнаособняка");
        assert_eq!(name_key("#2"), "#2");
    }

    #[test]
    fn pairs_single_card_with_suffix_has_no_pair() {
        let horny = with_base(card(27, "Hornycraft-0.33-pc", Some("Hornycraft.exe"), Some("Ren'Py")), "hornycraft#2");
        let other = card(28, "Maji-iki_0.420", Some("Magi-Iki.exe"), Some("Unity"));
        assert!(find_groups(&[horny.clone(), other], &none()).is_empty());

        let next = card(29, "Hornycraft-0.34-pc", Some("Hornycraft.exe"), Some("Ren'Py"));
        let found = find_groups(&[horny, next], &none());
        assert_eq!(ids(&found), vec![vec![27, 29]]);
        assert!(found[0].reasons.name);
    }

    #[test]
    fn pairs_unknown_engine_is_not_the_same_engine() {
        let a = card(1, "MoonlitManor-1.0-pc", Some("Adventure.exe"), Some("Other"));
        let b = card(2, "SilentHarbor-1.0-pc", Some("Adventure.exe"), Some("Other"));
        assert!(find_groups(&[a, b], &none()).is_empty());

        let c = card(3, "MoonlitManor-1.0-pc", Some("Adventure.exe"), Some("Unity"));
        let d = card(4, "Manor Nights v2.0", Some("Adventure 2.0.exe"), Some("Unity"));
        assert_eq!(ids(&find_groups(&[c, d], &none())), vec![vec![3, 4]]);
    }

    #[test]
    fn pairs_copy_mark_folder_still_pairs() {
        let copy = with_base(
            card(34, "DreamCorruption-v0.2.4-pc(1)", Some(r"DreamCorruption-v0.2.4-pc\DreamCorruption.exe"), Some("Other")),
            "dreamcorruptionpc1",
        );
        let next = card(41, "DreamCorruption-v0.3.0-pc", Some("DreamCorruption.exe"), Some("Other"));
        let found = find_groups(&[copy, next], &none());
        assert_eq!(ids(&found), vec![vec![34, 41]]);
        assert!(found[0].reasons.name);
        assert_eq!(found[0].reasons.exe, None);
    }

    #[test]
    fn pairs_mixed_reasons_in_a_group_are_not_invented() {
        let a = card(1, "Foo-1.0-pc", Some("SharedExe.exe"), Some("Unity"));
        let b = card(2, "Bar-1.0-pc", Some("SharedExe.exe"), Some("Unity"));
        let c = with_base(card(3, "Bar-2.0-pc", None, None), "foo");
        let found = find_groups(&[a, b, c], &none());
        assert_eq!(ids(&found), vec![vec![1, 2, 3]]);
        assert_eq!(found[0].reasons, MatchReasons::default());
    }

    #[test]
    fn pairs_three_versions_make_one_group() {
        let a = card(21, "PathOfDesire-0.5.2-pc", Some("PathOfDesire.exe"), Some("Ren'Py"));
        let b = card(40, "PathOfDesire-0.6.2-pc", Some("PathOfDesire.exe"), Some("Ren'Py"));
        let c = card(45, "PathOfDesire-0.7.0-pc", Some("PathOfDesire.exe"), Some("Ren'Py"));
        let found = find_groups(&[c, a, b], &none());
        assert_eq!(ids(&found), vec![vec![21, 40, 45]]);
        assert!(found[0].reasons.name);
        assert_eq!(found[0].reasons.exe.as_deref(), Some("PathOfDesire.exe"));
    }

    #[test]
    fn pairs_need_at_least_one_folder() {
        let mut a = card(1, "PathOfDesire-0.5.2-pc", None, None);
        let mut b = card(2, "PathOfDesire-0.6.2-pc", None, None);
        a.has_folder = false;
        b.has_folder = false;
        assert!(find_groups(&[a.clone(), b.clone()], &none()).is_empty());
        b.has_folder = true;
        assert_eq!(ids(&find_groups(&[a, b], &none())), vec![vec![1, 2]]);
    }

    #[test]
    fn pairs_found_after_sync_of_two_folders() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc"), folder("Hornycraft-0.33-pc")])
            .unwrap();
        let old = id_of(&conn, "PathOfDesire-0.5.2-pc");
        let new = id_of(&conn, "PathOfDesire-0.6.2-pc");
        assert_eq!(ids(&groups(&conn).unwrap()), vec![vec![old, new]]);
    }

    #[test]
    #[ignore]
    fn pairs_real_library_copy() {
        let path = std::env::var("BOOKED_REAL_DB").expect("BOOKED_REAL_DB");
        let conn = Connection::open(path).unwrap();
        crate::db::migrate(&conn).unwrap();
        let all = cards(&conn).unwrap();
        assert!(all.len() >= 30, "в копии библиотеки {} карточек", all.len());
        let base = |id: i64| all.iter().find(|c| c.id == id).map(|c| c.base_name.clone()).unwrap();
        let mut found: Vec<Vec<String>> = groups(&conn)
            .unwrap()
            .iter()
            .map(|g| g.ids.iter().map(|id| base(*id)).collect())
            .collect();
        found.sort();
        assert_eq!(
            found,
            vec![
                vec!["pathofdesire".to_string(), "pathofdesire#2".to_string()],
                vec!["pnc".to_string(), "pnc#2".to_string()],
            ]
        );
    }

    #[test]
    fn distinct_pair_is_not_proposed_again() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc")]).unwrap();
        let old = id_of(&conn, "PathOfDesire-0.5.2-pc");
        let new = id_of(&conn, "PathOfDesire-0.6.2-pc");
        assert_eq!(ids(&groups(&conn).unwrap()), vec![vec![old, new]]);

        mark_distinct(&mut conn, &[new, old]).unwrap();
        mark_distinct(&mut conn, &[old, new]).unwrap();
        assert!(groups(&conn).unwrap().is_empty());
        assert_eq!(distinct_marks(&conn).unwrap(), BTreeSet::from([ordered(old, new)]));
    }

    #[test]
    fn distinct_new_folder_of_either_is_still_proposed() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc")]).unwrap();
        let a = id_of(&conn, "PathOfDesire-0.5.2-pc");
        let b = id_of(&conn, "PathOfDesire-0.6.2-pc");
        mark_distinct(&mut conn, &[a, b]).unwrap();

        sync(
            &mut conn,
            &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc"), folder("PathOfDesire-0.7.0-pc")],
        )
        .unwrap();
        let c = id_of(&conn, "PathOfDesire-0.7.0-pc");
        let mut found = ids(&groups(&conn).unwrap());
        found.sort();
        assert_eq!(found, vec![vec![a, c], vec![b, c]]);
    }

    #[test]
    fn distinct_three_way_mark_covers_every_pair() {
        let mut conn = db();
        sync(
            &mut conn,
            &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc"), folder("PathOfDesire-0.7.0-pc")],
        )
        .unwrap();
        let all: Vec<i64> = groups(&conn).unwrap()[0].ids.clone();
        assert_eq!(all.len(), 3);
        mark_distinct(&mut conn, &all).unwrap();
        assert!(groups(&conn).unwrap().is_empty());
        assert_eq!(distinct_marks(&conn).unwrap().len(), 3);
    }

    #[test]
    fn distinct_marks_leave_with_the_card() {
        let mut conn = db();
        sync(&mut conn, &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc")]).unwrap();
        let a = id_of(&conn, "PathOfDesire-0.5.2-pc");
        let b = id_of(&conn, "PathOfDesire-0.6.2-pc");
        mark_distinct(&mut conn, &[a, b]).unwrap();
        games::forget(&conn, b).unwrap();
        assert!(distinct_marks(&conn).unwrap().is_empty());
    }

    #[test]
    fn missing_same_name_relinks_silently() {
        let mut conn = db();
        sync(&mut conn, &[folder("PNC 0.1.0 Win")]).unwrap();
        let id = id_of(&conn, "PNC 0.1.0 Win");
        games::set_rating(&conn, id, 4).unwrap();
        sync(&mut conn, &[]).unwrap();

        let report = sync(&mut conn, &[folder("PNC 0.3.1 Win")]).unwrap();
        assert_eq!(report.relinked, 1);
        assert_eq!(games::list(&conn).unwrap().len(), 1);
        assert!(groups(&conn).unwrap().is_empty());
        assert_eq!(games::get(&conn, id).unwrap().unwrap().rating, 4);
    }

    #[test]
    fn missing_other_name_same_exe_is_a_pair() {
        let mut conn = db();
        sync(&mut conn, &[folder("PNC 0.1.0 Win")]).unwrap();
        let old = id_of(&conn, "PNC 0.1.0 Win");
        games::set_exe(&conn, old, "PostNutCalamity 0.1.0.exe", false).unwrap();
        games::set_engine(&conn, old, "Unity").unwrap();
        sync(&mut conn, &[]).unwrap();

        sync(&mut conn, &[folder("Post Nut Calamity v0.4")]).unwrap();
        let new = id_of(&conn, "Post Nut Calamity v0.4");
        assert!(groups(&conn).unwrap().is_empty());

        games::set_exe(&conn, new, "Post Nut Calamity.exe", false).unwrap();
        games::set_engine(&conn, new, "Unity").unwrap();
        let found = groups(&conn).unwrap();
        assert_eq!(ids(&found), vec![vec![old, new]]);
        assert!(!found[0].reasons.name);
        assert_eq!(found[0].reasons.exe.as_deref(), Some("Post Nut Calamity.exe"));
    }
}
