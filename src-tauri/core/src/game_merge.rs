use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::games::{self, parse_folder_name, Game, Source};

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

#[derive(Debug, Clone)]
pub struct MergeCard {
    pub game: Game,
    pub created_at: i64,
    pub title_source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeptCandidate<'a> {
    pub id: i64,
    pub version: Option<&'a str>,
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedFields {
    pub title: String,
    pub title_source: String,
    pub folder_path: String,
    pub folder_name: Option<String>,
    pub size_bytes: Option<i64>,
    pub version_installed: Option<String>,
    pub version_source: String,
    pub exe_path: Option<String>,
    pub exe_source: String,
    pub rating: i64,
    pub status: String,
    pub image: Option<String>,
    pub image_x: f64,
    pub image_y: f64,
    pub page_url: Option<String>,
    pub source: Option<String>,
    pub site_version: Option<String>,
    pub seen_version: Option<String>,
    pub skipped_version: Option<String>,
    pub last_checked_at: Option<i64>,
    pub engine: Option<String>,
    pub last_launched_at: Option<i64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePlan {
    pub survivor_id: i64,
    pub kept_id: i64,
    pub leaving_ids: Vec<i64>,
    pub trash: Vec<String>,
    pub fields: MergedFields,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveFile {
    pub rel: String,
    pub modified: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCopy {
    pub from: String,
    pub to: String,
    pub replace: bool,
}

pub const SAVE_DIRS: &[&str] = &["game/saves", "www/save", "save", "saves"];
const SAVE_EXTENSIONS: &[&str] = &["rvdata2", "rvdata", "rxdata"];

pub fn pick_kept(candidates: &[KeptCandidate]) -> Option<i64> {
    let versioned = candidates
        .iter()
        .all(|c| c.version.is_some_and(games::looks_like_version));
    candidates
        .iter()
        .max_by(|a, b| {
            let by_version = if versioned {
                games::compare_versions(a.version.unwrap_or_default(), b.version.unwrap_or_default())
            } else {
                Ordering::Equal
            };
            by_version.then(a.modified.cmp(&b.modified)).then(a.id.cmp(&b.id))
        })
        .map(|c| c.id)
}

fn blank(value: Option<&str>) -> bool {
    value.map(str::trim).is_none_or(str::is_empty)
}

fn first_filled<'a>(survivor: &'a Game, donors: &[&'a Game], filled: impl Fn(&Game) -> bool) -> &'a Game {
    if filled(survivor) {
        return survivor;
    }
    donors.iter().copied().find(|game| filled(game)).unwrap_or(survivor)
}

pub fn plan_merge(cards: &[MergeCard], kept_id: i64, survivor_exe_in_kept: bool) -> Option<MergePlan> {
    if cards.len() < 2 {
        return None;
    }
    let mut sorted: Vec<&MergeCard> = cards.iter().collect();
    sorted.sort_by_key(|card| (card.created_at, card.game.id));
    let survivor = sorted[0];
    let kept = *sorted.iter().find(|card| card.game.id == kept_id)?;
    let folder_path = kept.game.folder_path.clone()?;
    let own_folder = kept.game.id == survivor.game.id;

    let mut donors: Vec<&Game> = Vec::new();
    if !own_folder {
        donors.push(&kept.game);
    }
    donors.extend(sorted[1..].iter().rev().map(|card| &card.game).filter(|game| game.id != kept.game.id));

    let old = &survivor.game;
    let rated = first_filled(old, &donors, |g| g.rating != 0);
    let status = first_filled(old, &donors, |g| g.status != "new");
    let covered = first_filled(old, &donors, |g| !blank(g.image.as_deref()));
    let paged = first_filled(old, &donors, |g| !blank(g.page_url.as_deref()));
    let engine = first_filled(old, &donors, |g| {
        !blank(g.engine.as_deref()) && g.engine.as_deref() != Some(games::ENGINE_UNKNOWN)
    });

    let (title, title_source) = if survivor.title_source != "folder" {
        (old.title.clone(), survivor.title_source.clone())
    } else {
        let parsed = kept.game.folder_name.as_deref().map(|name| games::parse_folder_name(name).title);
        (parsed.unwrap_or_else(|| kept.game.title.clone()), "folder".to_string())
    };

    let keep_manual_exe = !own_folder && old.exe_source == "manual" && old.exe_path.is_some() && survivor_exe_in_kept;
    let (exe_path, exe_source) = if keep_manual_exe {
        (old.exe_path.clone(), old.exe_source.clone())
    } else {
        (kept.game.exe_path.clone(), kept.game.exe_source.clone())
    };

    let mut tags: Vec<String> = Vec::new();
    for card in &sorted {
        for tag in &card.game.tags {
            let key = crate::tags::normalize(tag);
            if !key.is_empty() && !tags.iter().any(|known| crate::tags::normalize(known) == key) {
                tags.push(tag.clone());
            }
        }
    }

    let fields = MergedFields {
        title,
        title_source,
        folder_path,
        folder_name: kept.game.folder_name.clone(),
        size_bytes: kept.game.size_bytes,
        version_installed: kept.game.version_installed.clone(),
        version_source: kept.game.version_source.clone(),
        exe_path,
        exe_source,
        rating: rated.rating,
        status: status.status.clone(),
        image: covered.image.clone(),
        image_x: covered.image_x,
        image_y: covered.image_y,
        page_url: paged.page_url.clone(),
        source: paged.source.clone(),
        site_version: paged.site_version.clone(),
        seen_version: paged.seen_version.clone(),
        skipped_version: paged.skipped_version.clone(),
        last_checked_at: paged.last_checked_at,
        engine: engine.engine.clone(),
        last_launched_at: sorted.iter().filter_map(|card| card.game.last_launched_at).max(),
        tags,
    };

    Some(MergePlan {
        survivor_id: old.id,
        kept_id: kept.game.id,
        leaving_ids: sorted[1..].iter().map(|card| card.game.id).collect(),
        trash: sorted
            .iter()
            .filter(|card| card.game.id != kept.game.id)
            .filter_map(|card| card.game.folder_path.clone())
            .collect(),
        fields,
    })
}

pub fn merge_cards(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<MergeCard>> {
    let mut found = Vec::new();
    for &id in ids {
        let Some(game) = games::get(conn, id)? else {
            continue;
        };
        if found.iter().any(|card: &MergeCard| card.game.id == id) {
            continue;
        }
        let (created_at, title_source) = conn.query_row(
            "SELECT created_at, title_source FROM games WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        found.push(MergeCard { game, created_at, title_source });
    }
    found.sort_by_key(|card| (card.created_at, card.game.id));
    Ok(found)
}

pub fn apply_merge(conn: &mut Connection, plan: &MergePlan) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let exists = |id: i64| -> rusqlite::Result<bool> {
        tx.query_row("SELECT EXISTS(SELECT 1 FROM games WHERE id = ?1)", params![id], |row| row.get(0))
    };
    for &id in std::iter::once(&plan.survivor_id).chain(&plan.leaving_ids) {
        if !exists(id)? {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
    }

    for &leaving in &plan.leaving_ids {
        let others: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT CASE WHEN a_id = ?1 THEN b_id ELSE a_id END FROM game_distinct \
                 WHERE a_id = ?1 OR b_id = ?1",
            )?;
            let rows = stmt.query_map(params![leaving], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?;
            rows
        };
        for other in others {
            if other == plan.survivor_id || plan.leaving_ids.contains(&other) {
                continue;
            }
            let (low, high) = ordered(plan.survivor_id, other);
            tx.execute(
                "INSERT OR IGNORE INTO game_distinct (a_id, b_id) VALUES (?1, ?2)",
                params![low, high],
            )?;
        }
        tx.execute("DELETE FROM games WHERE id = ?1", params![leaving])?;
    }

    let f = &plan.fields;
    let kept_base = f.folder_name.as_deref().map(|name| games::parse_folder_name(name).base_name);
    let current_base: String =
        tx.query_row("SELECT base_name FROM games WHERE id = ?1", params![plan.survivor_id], |row| row.get(0))?;
    let base = match kept_base {
        Some(next) if name_key(&current_base) != next => games::unique_base(&tx, &next)?,
        _ => current_base,
    };

    tx.execute(
        "UPDATE games SET base_name = ?1, title = ?2, title_source = ?3, folder_path = ?4, folder_name = ?5, \
         size_bytes = ?6, version_installed = ?7, version_source = ?8, exe_path = ?9, exe_source = ?10, \
         rating = ?11, status = ?12, image = ?13, image_x = ?14, image_y = ?15, page_url = ?16, source = ?17, \
         site_version = ?18, seen_version = ?19, skipped_version = ?20, last_checked_at = ?21, engine = ?22, \
         last_launched_at = ?23, updated_at = unixepoch() WHERE id = ?24",
        params![
            base,
            f.title,
            f.title_source,
            f.folder_path,
            f.folder_name,
            f.size_bytes,
            f.version_installed,
            f.version_source,
            f.exe_path,
            f.exe_source,
            f.rating,
            f.status,
            f.image,
            f.image_x,
            f.image_y,
            f.page_url,
            f.source,
            f.site_version,
            f.seen_version,
            f.skipped_version,
            f.last_checked_at,
            f.engine,
            f.last_launched_at,
            plan.survivor_id
        ],
    )?;

    tx.execute("DELETE FROM game_tags WHERE game_id = ?1", params![plan.survivor_id])?;
    for name in &f.tags {
        if let Some(tag_id) = crate::tags::upsert(&tx, name)? {
            tx.execute(
                "INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?1, ?2)",
                params![plan.survivor_id, tag_id],
            )?;
        }
    }
    tx.commit()
}

fn save_key(rel: &str) -> String {
    rel.replace('\\', "/").trim_start_matches('/').to_lowercase()
}

pub fn is_save_path(rel: &str) -> bool {
    let key = save_key(rel);
    if key.split('/').any(|part| part == ".." || part.contains(':')) {
        return false;
    }
    if SAVE_DIRS.iter().any(|dir| key.starts_with(&format!("{dir}/")) && key.len() > dir.len() + 1) {
        return true;
    }
    !key.contains('/')
        && key.starts_with("save")
        && key
            .rsplit_once('.')
            .is_some_and(|(_, ext)| SAVE_EXTENSIONS.contains(&ext))
}

pub fn saves_plan(leaving: &[SaveFile], kept: &[SaveFile]) -> Vec<SaveCopy> {
    let mut copies = Vec::new();
    for file in leaving.iter().filter(|file| is_save_path(&file.rel)) {
        let key = save_key(&file.rel);
        match kept.iter().find(|other| save_key(&other.rel) == key) {
            None => copies.push(SaveCopy { from: file.rel.clone(), to: file.rel.clone(), replace: false }),
            Some(existing) if file.modified > existing.modified => copies.push(SaveCopy {
                from: file.rel.clone(),
                to: existing.rel.clone(),
                replace: true,
            }),
            Some(_) => {}
        }
    }
    copies
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
        assert_eq!(ids(&groups(&conn).unwrap()), Vec::<Vec<i64>>::new());
        let mut merged: Vec<(String, Option<String>)> = all
            .iter()
            .filter(|c| c.base_name.starts_with("pathofdesire") || c.base_name.starts_with("pnc"))
            .map(|c| (c.base_name.clone(), c.folder_name.clone()))
            .collect();
        merged.sort();
        assert_eq!(
            merged,
            vec![
                ("pathofdesire".to_string(), Some("PathOfDesire-0.6.2-pc".to_string())),
                ("pnc".to_string(), Some("PNC 0.3.1 Win".to_string())),
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

    fn merge(conn: &mut Connection, ids: &[i64], kept: i64) -> MergePlan {
        let cards = merge_cards(conn, ids).unwrap();
        let plan = plan_merge(&cards, kept, false).unwrap();
        apply_merge(conn, &plan).unwrap();
        plan
    }

    fn pod(conn: &mut Connection) -> (i64, i64) {
        sync(conn, &[folder("PathOfDesire-0.5.2-pc")]).unwrap();
        sync(conn, &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc")]).unwrap();
        (id_of(conn, "PathOfDesire-0.5.2-pc"), id_of(conn, "PathOfDesire-0.6.2-pc"))
    }

    fn created_at(conn: &Connection, id: i64) -> i64 {
        conn.query_row("SELECT created_at FROM games WHERE id = ?1", params![id], |row| row.get(0)).unwrap()
    }

    #[test]
    fn merge_old_card_wins_and_blanks_come_from_new() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        conn.execute("UPDATE games SET created_at = created_at - 86400 WHERE id = ?1", params![old]).unwrap();
        let born = created_at(&conn, old);
        games::set_status(&conn, old, "playing").unwrap();
        games::set_page(&conn, old, Some("https://f95zone.to/threads/path-of-desire.100000/")).unwrap();
        games::record_check(&conn, old, Some("0.7.0"), false).unwrap();
        games::set_engine(&conn, old, "Ren'Py").unwrap();
        games::set_tags(&mut conn, old, &["фэнтези".to_string()]).unwrap();
        games::set_rating(&conn, new, 4).unwrap();
        games::set_status(&conn, new, "finished").unwrap();
        games::set_image(&conn, new, Some("new.png")).unwrap();
        games::set_cover_pos(&conn, new, 20.0, 80.0).unwrap();
        games::set_tags(&mut conn, new, &["Фэнтези".to_string(), "визуальная новелла".to_string()]).unwrap();
        games::mark_launched(&conn, new).unwrap();

        let plan = merge(&mut conn, &[new, old], new);
        assert_eq!(plan.survivor_id, old);
        assert_eq!(plan.leaving_ids, vec![new]);
        assert_eq!(plan.trash, vec!["E:\\Games\\PathOfDesire-0.5.2-pc".to_string()]);

        let all = games::list(&conn).unwrap();
        assert_eq!(all.len(), 1);
        let game = &all[0];
        assert_eq!(game.id, old);
        assert_eq!(created_at(&conn, old), born);
        assert_eq!(game.base_name, "pathofdesire");
        assert_eq!(game.title, "Path Of Desire");
        assert_eq!(game.folder_path.as_deref(), Some("E:\\Games\\PathOfDesire-0.6.2-pc"));
        assert_eq!(game.folder_name.as_deref(), Some("PathOfDesire-0.6.2-pc"));
        assert_eq!(game.version_installed.as_deref(), Some("0.6.2"));
        assert_eq!(game.rating, 4);
        assert_eq!(game.status, "playing");
        assert_eq!(game.image.as_deref(), Some("new.png"));
        assert_eq!((game.image_x, game.image_y), (20.0, 80.0));
        assert_eq!(game.page_url.as_deref(), Some("https://f95zone.to/threads/path-of-desire.100000/"));
        assert_eq!(game.source.as_deref(), Some("f95"));
        assert_eq!(game.site_version.as_deref(), Some("0.7.0"));
        assert!(game.has_update);
        assert_eq!(game.engine.as_deref(), Some("Ren'Py"));
        assert!(game.last_launched_at.is_some());
        assert_eq!(game.tags, vec!["визуальная новелла".to_string(), "фэнтези".to_string()]);
        let links: i64 = conn.query_row("SELECT COUNT(*) FROM game_tags", [], |row| row.get(0)).unwrap();
        assert_eq!(links, 2);
    }

    #[test]
    fn merge_filled_old_fields_are_not_overwritten() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        games::set_rating(&conn, old, 2).unwrap();
        games::set_image(&conn, old, Some("old.png")).unwrap();
        games::set_engine(&conn, old, "Ren'Py").unwrap();
        games::set_rating(&conn, new, 5).unwrap();
        games::set_image(&conn, new, Some("new.png")).unwrap();
        games::set_engine(&conn, new, "Unity").unwrap();
        games::set_page(&conn, new, Some("https://f95zone.to/threads/other.5/")).unwrap();

        merge(&mut conn, &[old, new], new);
        let game = games::get(&conn, old).unwrap().unwrap();
        assert_eq!(game.rating, 2);
        assert_eq!(game.image.as_deref(), Some("old.png"));
        assert_eq!(game.engine.as_deref(), Some("Ren'Py"));
        assert_eq!(game.page_url.as_deref(), Some("https://f95zone.to/threads/other.5/"));
        assert!(games::get(&conn, new).unwrap().is_none());
    }

    #[test]
    fn merge_unknown_engine_counts_as_blank() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        games::set_engine(&conn, old, games::ENGINE_UNKNOWN).unwrap();
        games::set_engine(&conn, new, "Ren'Py").unwrap();
        merge(&mut conn, &[old, new], new);
        assert_eq!(games::get(&conn, old).unwrap().unwrap().engine.as_deref(), Some("Ren'Py"));
    }

    #[test]
    fn merge_manual_title_stays_and_manual_version_only_with_own_folder() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        games::set_title(&conn, old, "Путь желания").unwrap();
        games::set_version(&conn, old, Some("0.5.3")).unwrap();

        let cards = merge_cards(&conn, &[old, new]).unwrap();
        let to_new = plan_merge(&cards, new, false).unwrap();
        assert_eq!(to_new.fields.title, "Путь желания");
        assert_eq!(to_new.fields.title_source, "manual");
        assert_eq!(to_new.fields.version_installed.as_deref(), Some("0.6.2"));
        assert_eq!(to_new.fields.version_source, "folder");

        let to_old = plan_merge(&cards, old, false).unwrap();
        assert_eq!(to_old.fields.version_installed.as_deref(), Some("0.5.3"));
        assert_eq!(to_old.fields.version_source, "manual");
        assert_eq!(to_old.fields.folder_name.as_deref(), Some("PathOfDesire-0.5.2-pc"));

        apply_merge(&mut conn, &to_new).unwrap();
        let game = games::get(&conn, old).unwrap().unwrap();
        assert_eq!(game.title, "Путь желания");
        sync(&mut conn, &[folder("PathOfDesire-0.6.2-pc")]).unwrap();
        assert_eq!(games::get(&conn, old).unwrap().unwrap().title, "Путь желания");
    }

    #[test]
    fn merge_folder_title_comes_from_kept_folder() {
        let mut conn = db();
        sync(&mut conn, &[folder("PNC 0.1.0 Win"), folder("Post Nut Calamity v0.4")]).unwrap();
        let old = id_of(&conn, "PNC 0.1.0 Win");
        let new = id_of(&conn, "Post Nut Calamity v0.4");
        let cards = merge_cards(&conn, &[old, new]).unwrap();
        let plan = plan_merge(&cards, new, false).unwrap();
        assert_eq!(plan.fields.title, "Post Nut Calamity");
        assert_eq!(plan.fields.title_source, "folder");
        assert_eq!(plan_merge(&cards, old, false).unwrap().fields.title, "PNC");
    }

    #[test]
    fn merge_keeps_title_taken_from_site() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        games::set_site_title(&conn, old, "Path of Desire").unwrap();
        let cards = merge_cards(&conn, &[old, new]).unwrap();
        let plan = plan_merge(&cards, new, false).unwrap();
        assert_eq!(plan.fields.title, "Path of Desire");
        assert_eq!(plan.fields.title_source, "site");
    }

    #[test]
    fn merge_exe_rules() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        games::set_exe(&conn, old, "bin\\Start.exe", true).unwrap();
        games::set_exe(&conn, new, "PathOfDesire.exe", false).unwrap();
        let cards = merge_cards(&conn, &[old, new]).unwrap();

        let found = plan_merge(&cards, new, true).unwrap();
        assert_eq!(found.fields.exe_path.as_deref(), Some("bin\\Start.exe"));
        assert_eq!(found.fields.exe_source, "manual");

        let absent = plan_merge(&cards, new, false).unwrap();
        assert_eq!(absent.fields.exe_path.as_deref(), Some("PathOfDesire.exe"));
        assert_eq!(absent.fields.exe_source, "auto");

        let own = plan_merge(&cards, old, false).unwrap();
        assert_eq!(own.fields.exe_path.as_deref(), Some("bin\\Start.exe"));
        assert_eq!(own.fields.exe_source, "manual");
    }

    #[test]
    fn merge_three_versions_at_once() {
        let mut conn = db();
        sync(
            &mut conn,
            &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc"), folder("PathOfDesire-0.7.0-pc")],
        )
        .unwrap();
        let group = groups(&conn).unwrap().remove(0);
        let newest = id_of(&conn, "PathOfDesire-0.7.0-pc");
        let plan = merge(&mut conn, &group.ids, newest);
        assert_eq!(plan.survivor_id, group.ids[0]);
        assert_eq!(plan.leaving_ids.len(), 2);
        assert_eq!(plan.trash.len(), 2);
        assert!(!plan.trash.iter().any(|path| path.ends_with("0.7.0-pc")));
        let all = games::list(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].version_installed.as_deref(), Some("0.7.0"));
        assert!(groups(&conn).unwrap().is_empty());
    }

    #[test]
    fn merge_base_name_follows_the_kept_folder() {
        let mut conn = db();
        sync(&mut conn, &[folder("PNC 0.1.0 Win"), folder("Post Nut Calamity v0.4")]).unwrap();
        let old = id_of(&conn, "PNC 0.1.0 Win");
        let new = id_of(&conn, "Post Nut Calamity v0.4");
        merge(&mut conn, &[old, new], new);
        assert_eq!(games::get(&conn, old).unwrap().unwrap().base_name, "postnutcalamity");

        let report = sync(&mut conn, &[folder("Post Nut Calamity v0.5")]).unwrap();
        assert_eq!(report.relinked, 1);
        assert_eq!(games::list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn merge_base_name_taken_by_another_card_gets_a_free_one() {
        let mut conn = db();
        sync(&mut conn, &[folder("PNC 0.1.0 Win"), folder("PostNutCalamity-1.0-pc"), folder("Post Nut Calamity v0.4")])
            .unwrap();
        let old = id_of(&conn, "PNC 0.1.0 Win");
        let stranger = id_of(&conn, "PostNutCalamity-1.0-pc");
        let new = id_of(&conn, "Post Nut Calamity v0.4");
        assert_eq!(games::get(&conn, new).unwrap().unwrap().base_name, "postnutcalamity#2");

        merge(&mut conn, &[old, new], new);
        assert_eq!(games::get(&conn, old).unwrap().unwrap().base_name, "postnutcalamity#2");
        assert_eq!(games::get(&conn, stranger).unwrap().unwrap().base_name, "postnutcalamity");

        let mut again = db();
        sync(&mut again, &[folder("Game-1.0-pc"), folder("Game-2.0-pc")]).unwrap();
        let first = id_of(&again, "Game-1.0-pc");
        let second = id_of(&again, "Game-2.0-pc");
        merge(&mut again, &[first, second], second);
        assert_eq!(games::get(&again, first).unwrap().unwrap().base_name, "game");
    }

    #[test]
    fn merge_failed_apply_changes_nothing() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        games::set_rating(&conn, new, 5).unwrap();
        let cards = merge_cards(&conn, &[old, new]).unwrap();
        let plan = plan_merge(&cards, new, false).unwrap();
        let mut broken = plan.clone();
        broken.leaving_ids.push(9_999);
        assert!(apply_merge(&mut conn, &broken).is_err());
        assert_eq!(games::list(&conn).unwrap().len(), 2);
        assert_eq!(games::get(&conn, old).unwrap().unwrap().rating, 0);

        apply_merge(&mut conn, &plan).unwrap();
        assert_eq!(games::list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn distinct_marks_survive_merge() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        sync(
            &mut conn,
            &[folder("PathOfDesire-0.5.2-pc"), folder("PathOfDesire-0.6.2-pc"), folder("Hornycraft-0.33-pc"), folder("Maji-iki_0.420")],
        )
        .unwrap();
        let horny = id_of(&conn, "Hornycraft-0.33-pc");
        let maji = id_of(&conn, "Maji-iki_0.420");
        mark_distinct(&mut conn, &[old, horny]).unwrap();
        mark_distinct(&mut conn, &[new, maji]).unwrap();

        merge(&mut conn, &[old, new], new);
        assert_eq!(
            distinct_marks(&conn).unwrap(),
            BTreeSet::from([ordered(old, horny), ordered(old, maji)])
        );
    }

    #[test]
    fn kept_bigger_version_wins() {
        let pick = |a: &str, am: i64, b: &str, bm: i64| {
            pick_kept(&[
                KeptCandidate { id: 1, version: Some(a), modified: Some(am) },
                KeptCandidate { id: 2, version: Some(b), modified: Some(bm) },
            ])
        };
        assert_eq!(pick("0.5.2", 900, "0.6.2", 100), Some(2));
        assert_eq!(pick("0.6.2", 100, "0.5.2", 900), Some(1));
        assert_eq!(pick("0.10.0", 1, "0.9.0", 2), Some(1));
        assert_eq!(pick("1.0", 1, "1.0.0", 2), Some(2));
    }

    #[test]
    fn kept_fresher_folder_without_versions() {
        let without = [
            KeptCandidate { id: 1, version: None, modified: Some(500) },
            KeptCandidate { id: 2, version: None, modified: Some(300) },
        ];
        assert_eq!(pick_kept(&without), Some(1));
        let mixed = [
            KeptCandidate { id: 1, version: Some("9.0"), modified: Some(100) },
            KeptCandidate { id: 2, version: None, modified: Some(300) },
        ];
        assert_eq!(pick_kept(&mixed), Some(2));
        let unknown = [
            KeptCandidate { id: 1, version: None, modified: None },
            KeptCandidate { id: 2, version: None, modified: Some(1) },
        ];
        assert_eq!(pick_kept(&unknown), Some(2));
        assert_eq!(pick_kept(&[]), None);
    }

    #[test]
    fn kept_choice_is_swappable() {
        let mut conn = db();
        let (old, new) = pod(&mut conn);
        let cards = merge_cards(&conn, &[old, new]).unwrap();
        let forward = plan_merge(&cards, new, false).unwrap();
        let back = plan_merge(&cards, old, false).unwrap();
        assert_eq!(forward.fields.folder_path, "E:\\Games\\PathOfDesire-0.6.2-pc");
        assert_eq!(forward.trash, vec!["E:\\Games\\PathOfDesire-0.5.2-pc".to_string()]);
        assert_eq!(back.fields.folder_path, "E:\\Games\\PathOfDesire-0.5.2-pc");
        assert_eq!(back.trash, vec!["E:\\Games\\PathOfDesire-0.6.2-pc".to_string()]);
        assert_eq!(forward.survivor_id, back.survivor_id);
        assert!(plan_merge(&cards, 9_999, false).is_none());
        assert!(plan_merge(&cards[..1], old, false).is_none());
    }

    #[test]
    fn saves_missing_files_are_copied() {
        let leaving = [
            SaveFile { rel: "game\\saves\\1-1-LT1.save".into(), modified: 10 },
            SaveFile { rel: "game/saves/persistent".into(), modified: 10 },
        ];
        let plan = saves_plan(&leaving, &[]);
        assert_eq!(
            plan,
            vec![
                SaveCopy { from: "game\\saves\\1-1-LT1.save".into(), to: "game\\saves\\1-1-LT1.save".into(), replace: false },
                SaveCopy { from: "game/saves/persistent".into(), to: "game/saves/persistent".into(), replace: false },
            ]
        );
    }

    #[test]
    fn saves_newer_wins() {
        let leaving = [
            SaveFile { rel: "game/saves/1.save".into(), modified: 200 },
            SaveFile { rel: "game/saves/2.save".into(), modified: 100 },
            SaveFile { rel: "game/saves/3.save".into(), modified: 150 },
        ];
        let kept = [
            SaveFile { rel: "Game/Saves/1.save".into(), modified: 100 },
            SaveFile { rel: "game/saves/2.save".into(), modified: 200 },
            SaveFile { rel: "game/saves/3.save".into(), modified: 150 },
        ];
        assert_eq!(
            saves_plan(&leaving, &kept),
            vec![SaveCopy { from: "game/saves/1.save".into(), to: "Game/Saves/1.save".into(), replace: true }]
        );
    }

    #[test]
    fn saves_other_files_are_left_alone() {
        for rel in [
            "game/saves/1-1-LT1.save",
            "www/save/file1.rpgsave",
            "save/slot1.dat",
            "saves/auto.sav",
            "Save01.rvdata2",
            "Save2.rxdata",
            "save03.rvdata",
        ] {
            assert!(is_save_path(rel), "{rel}");
        }
        for rel in [
            "game/saves/../../evil.exe",
            "saves/../PathOfDesire.exe",
            "save/C:/Windows/x.dll",
            "game/script.rpy",
            "game/saves",
            "game/saves_backup/1.save",
            "renpy/common/00save.rpy",
            "data/Save01.rvdata2",
            "Game.rgss3a",
            "savegame.txt",
            "PathOfDesire.exe",
        ] {
            assert!(!is_save_path(rel), "{rel}");
        }
        let leaving = [
            SaveFile { rel: "game/script.rpy".into(), modified: 999 },
            SaveFile { rel: "lib/python.dll".into(), modified: 999 },
            SaveFile { rel: "www/save/file1.rpgsave".into(), modified: 1 },
        ];
        assert_eq!(saves_plan(&leaving, &[]).len(), 1);
    }

    #[test]
    fn missing_old_card_merge_has_nothing_to_trash() {
        let mut conn = db();
        sync(&mut conn, &[folder("PNC 0.1.0 Win")]).unwrap();
        let old = id_of(&conn, "PNC 0.1.0 Win");
        games::set_page(&conn, old, Some("https://f95zone.to/threads/pnc.200000/")).unwrap();
        sync(&mut conn, &[folder("Post Nut Calamity v0.4")]).unwrap();
        let new = id_of(&conn, "Post Nut Calamity v0.4");

        let cards = merge_cards(&conn, &[old, new]).unwrap();
        assert!(plan_merge(&cards, old, false).is_none());
        let plan = plan_merge(&cards, new, false).unwrap();
        assert!(plan.trash.is_empty());
        apply_merge(&mut conn, &plan).unwrap();
        let game = games::get(&conn, old).unwrap().unwrap();
        assert_eq!(game.folder_name.as_deref(), Some("Post Nut Calamity v0.4"));
        assert_eq!(game.page_url.as_deref(), Some("https://f95zone.to/threads/pnc.200000/"));
        assert_eq!(game.version_installed.as_deref(), Some("0.4"));
    }
}
