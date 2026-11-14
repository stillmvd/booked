use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::games::{normalize_base, parse_folder_name};

pub const ARCHIVE_EXTENSIONS: [&str; 3] = ["zip", "7z", "rar"];
pub const CREATED_GRACE_MS: i64 = 5000;
pub const MAX_IGNORED: usize = 50;
const MIN_PREFIX: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSeen {
    pub path: PathBuf,
    pub size: u64,
    pub modified: i64,
    pub created: i64,
}

#[derive(Debug, Default)]
pub struct Watch {
    last: HashMap<PathBuf, (u64, i64)>,
    done: HashSet<PathBuf>,
}

impl Watch {
    pub fn new(ignored: impl IntoIterator<Item = PathBuf>) -> Watch {
        Watch { last: HashMap::new(), done: ignored.into_iter().collect() }
    }

    pub fn poll(&mut self, files: Vec<FileSeen>, since: i64, known: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
        let present: HashSet<&PathBuf> = files.iter().map(|file| &file.path).collect();
        self.done.retain(|path| present.contains(path));
        let mut ready = Vec::new();
        let mut next = HashMap::new();
        for file in &files {
            let name = file.path.file_name().map(|name| name.to_string_lossy()).unwrap_or_default();
            let fresh = file.created >= since - CREATED_GRACE_MS;
            if !fresh || file.size == 0 || !is_archive_name(&name) || self.done.contains(&file.path) || known(&file.path) {
                continue;
            }
            let stamp = (file.size, file.modified);
            if self.last.get(&file.path) == Some(&stamp) {
                self.done.insert(file.path.clone());
                ready.push(file.path.clone());
            } else {
                next.insert(file.path.clone(), stamp);
            }
        }
        self.last = next;
        ready
    }

    pub fn idle(&mut self) {
        self.last.clear();
    }
}

pub fn remember_ignored(mut list: Vec<String>, path: &str) -> Vec<String> {
    list.retain(|item| item != path);
    list.push(path.to_string());
    let extra = list.len().saturating_sub(MAX_IGNORED);
    list.drain(..extra);
    list
}

pub fn archive_stem(name: &str) -> Option<&str> {
    if name.starts_with('.') {
        return None;
    }
    let (stem, ext) = name.rsplit_once('.')?;
    let known = ARCHIVE_EXTENSIONS.iter().any(|known| known.eq_ignore_ascii_case(ext));
    (known && !stem.trim().is_empty()).then_some(stem)
}

pub fn is_archive_name(name: &str) -> bool {
    archive_stem(name).is_some()
}

pub fn archive_key(name: &str) -> Option<String> {
    let stem = archive_stem(name)?;
    let key = normalize_base(&parse_folder_name(stem).title);
    (!key.is_empty()).then_some(key)
}

fn related(a: &str, b: &str) -> Option<bool> {
    if a == b {
        return Some(true);
    }
    let (short, long) = if a.chars().count() <= b.chars().count() { (a, b) } else { (b, a) };
    (short.chars().count() >= MIN_PREFIX && long.starts_with(short)).then_some(false)
}

pub fn match_archive<T: Copy>(name: &str, waiting: &[(T, &str)]) -> Vec<T> {
    let Some(key) = archive_key(name) else {
        return Vec::new();
    };
    let mut exact = Vec::new();
    let mut close = Vec::new();
    for (id, title) in waiting {
        let title = normalize_base(title);
        if title.is_empty() {
            continue;
        }
        match related(&key, &title) {
            Some(true) => exact.push(*id),
            Some(false) => close.push(*id),
            None => {}
        }
    }
    exact.extend(close);
    exact
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_names_are_recognised_by_extension() {
        for name in ["NewStart-0.2-pc.zip", "Game.7Z", "Игра v1.RAR", "a.part1.rar"] {
            assert!(is_archive_name(name), "{name}");
        }
        for name in [
            "NewStart-0.2-pc.zip.part",
            "Game.zip.crdownload",
            "Game.7z.001",
            "Game.tmp",
            ".zip",
            ".hidden.zip",
            "readme.txt",
            "zip",
        ] {
            assert!(!is_archive_name(name), "{name}");
        }
    }

    #[test]
    fn real_f95_names_match_their_games() {
        let waiting = [(1, "New Start"), (2, "The 21 Desires"), (3, "Fantasy Date")];
        assert_eq!(match_archive("NewStart-0.2-pc.zip", &waiting), vec![1]);
        assert_eq!(match_archive("The21Desires-v0.1.3-Public.zip", &waiting), vec![2]);
        assert_eq!(match_archive("FantasyDate-0.3-win.7z", &waiting), vec![3]);
        assert_eq!(match_archive("Fantasy_Date_v0.3.rar", &waiting), vec![3]);
    }

    #[test]
    fn sequel_and_original_both_become_candidates() {
        let waiting = [(1, "Lust Academy"), (2, "Lust Academy 2"), (3, "Other")];
        assert_eq!(match_archive("LustAcademy-1.2.zip", &waiting), vec![1, 2]);
    }

    #[test]
    fn unrelated_or_too_short_names_do_not_match() {
        let waiting = [(1, "New Start"), (2, "Ark")];
        assert!(match_archive("Photos-1-001.zip", &waiting).is_empty());
        assert!(match_archive("Arkham-1.0.zip", &waiting).is_empty());
        assert!(match_archive("New.txt", &waiting).is_empty());
    }

    #[test]
    fn cyrillic_titles_match() {
        let waiting = [(1, "Тайна особняка"), (2, "Тёмный лес")];
        assert_eq!(match_archive("ТайнаОсобняка-1.0.zip", &waiting), vec![1]);
        assert_eq!(match_archive("тёмный_лес_v2.7z", &waiting), vec![2]);
    }

    fn seen(name: &str, size: u64, modified: i64, created: i64) -> FileSeen {
        FileSeen { path: PathBuf::from(format!(r"C:\Downloads\{name}")), size, modified, created }
    }

    #[test]
    fn file_is_ready_after_two_equal_polls() {
        let mut watch = Watch::default();
        assert!(watch.poll(vec![seen("a.zip", 10, 1, 1000)], 1000, |_| false).is_empty());
        assert!(watch.poll(vec![seen("a.zip", 20, 2, 1000)], 1000, |_| false).is_empty());
        let ready = watch.poll(vec![seen("a.zip", 20, 2, 1000)], 1000, |_| false);
        assert_eq!(ready, vec![PathBuf::from(r"C:\Downloads\a.zip")]);
        assert!(watch.poll(vec![seen("a.zip", 20, 2, 1000)], 1000, |_| false).is_empty());
    }

    #[test]
    fn partial_empty_old_and_known_files_are_skipped() {
        let mut watch = Watch::default();
        let files = vec![
            seen("a.zip.part", 10, 1, 1000),
            seen("b.zip", 0, 1, 1000),
            seen("c.zip", 10, 1, 1000 - CREATED_GRACE_MS - 1),
            seen("d.zip", 10, 1, 1000),
            seen("e.7z", 10, 1, 1000 - CREATED_GRACE_MS),
        ];
        let known = |path: &Path| path.ends_with("d.zip");
        watch.poll(files.clone(), 1000, known);
        let ready = watch.poll(files, 1000, known);
        assert_eq!(ready, vec![PathBuf::from(r"C:\Downloads\e.7z")]);
    }

    #[test]
    fn ignored_files_stay_ignored_until_they_vanish() {
        let path = PathBuf::from(r"C:\Downloads\a.zip");
        let mut watch = Watch::new([path.clone()]);
        let file = seen("a.zip", 10, 1, 1000);
        watch.poll(vec![file.clone()], 1000, |_| false);
        assert!(watch.poll(vec![file.clone()], 1000, |_| false).is_empty());
        watch.poll(vec![], 1000, |_| false);
        watch.poll(vec![file.clone()], 1000, |_| false);
        assert_eq!(watch.poll(vec![file], 1000, |_| false), vec![path]);
    }

    #[test]
    fn ignored_list_keeps_last_fifty_unique_paths() {
        let mut list = Vec::new();
        for n in 0..60 {
            list = remember_ignored(list, &format!("p{n}"));
        }
        list = remember_ignored(list, "p20");
        assert_eq!(list.len(), MAX_IGNORED);
        assert_eq!(list.first().map(String::as_str), Some("p10"));
        assert_eq!(list.last().map(String::as_str), Some("p20"));
    }

    #[test]
    fn exact_match_goes_before_prefix_match() {
        let waiting = [(1, "Lust Academy 2"), (2, "Lust Academy")];
        assert_eq!(match_archive("LustAcademy-1.2.zip", &waiting), vec![2, 1]);
    }
}
