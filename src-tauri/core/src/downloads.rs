use std::collections::VecDeque;

use serde::Serialize;

use crate::download_hosts::{self, Link};

pub const SPEED_WINDOW_MS: i64 = 3000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Waiting,
    Queued,
    Downloading,
    Unpacking,
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    Limit,
    Expired,
    Other,
    Network,
    NotArchive,
    NoSpace,
    Unpack,
}

impl Reason {
    pub fn code(self) -> &'static str {
        match self {
            Reason::Limit => "limit",
            Reason::Expired => "expired",
            Reason::Other => "other",
            Reason::Network => "network",
            Reason::NotArchive => "not-archive",
            Reason::NoSpace => "no-space",
            Reason::Unpack => "unpack",
        }
    }

    pub fn from_code(code: &str) -> Option<Reason> {
        Some(match code {
            "limit" => Reason::Limit,
            "expired" => Reason::Expired,
            "other" => Reason::Other,
            "network" => Reason::Network,
            "not-archive" => Reason::NotArchive,
            "no-space" => Reason::NoSpace,
            "unpack" => Reason::Unpack,
            _ => return None,
        })
    }

    pub fn message(self) -> &'static str {
        match self {
            Reason::Limit => "Файлообменник ограничил скачивание — нажми «Повторить» позже",
            Reason::Expired => "Ссылка устарела или файл удалён — вставь новую ссылку",
            Reason::Other => "Не получилось скачать — нажми «Повторить»",
            Reason::Network => "Соединение оборвалось — нажми «Повторить»",
            Reason::NotArchive => "По ссылке не архив — вставь ссылку на .zip, .7z или .rar",
            Reason::NoSpace => "Не хватает места на диске с играми — освободи место и нажми «Повторить»",
            Reason::Unpack => "Не получилось распаковать архив — нажми «Повторить»",
        }
    }

    fn pauses(self) -> bool {
        self == Reason::Limit
    }

    fn drops_link(self) -> bool {
        matches!(self, Reason::Expired | Reason::NotArchive)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueError {
    Unknown,
    WrongState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Part {
    pub dir: String,
    pub name: String,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Download {
    pub id: u64,
    pub game: i64,
    pub host: String,
    pub url: String,
    pub file: Option<String>,
    pub part: Option<Part>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saved {
    pub game: i64,
    pub failed: bool,
    pub reason: Option<Reason>,
    pub part: Option<Part>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resume {
    Append(u64),
    Restart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentRange {
    pub start: u64,
    pub end: u64,
    pub total: u64,
}

pub fn parse_content_range(value: &str) -> Option<ContentRange> {
    let rest = value.trim().strip_prefix("bytes")?.trim_start();
    let (span, total) = rest.split_once('/')?;
    let (start, end) = span.trim().split_once('-')?;
    let start = start.trim().parse().ok()?;
    let end = end.trim().parse().ok()?;
    let total = total.trim().parse().ok()?;
    if start > end || end >= total {
        return None;
    }
    Some(ContentRange { start, end, total })
}

pub fn resume_decision(have: u64, saved_total: Option<u64>, status: u16, content_range: Option<&str>) -> Resume {
    if have == 0 || status != 206 {
        return Resume::Restart;
    }
    let Some(saved_total) = saved_total else { return Resume::Restart };
    match content_range.and_then(parse_content_range) {
        Some(range) if range.start == have && range.total == saved_total && range.end + 1 == saved_total => Resume::Append(have),
        _ => Resume::Restart,
    }
}

#[derive(Debug, Clone)]
struct Row {
    part: Option<Part>,
    id: u64,
    game: i64,
    title: String,
    state: State,
    reason: Option<Reason>,
    message: Option<String>,
    link: Option<Link>,
    started: bool,
    reused: bool,
    received: u64,
    total: Option<u64>,
    samples: VecDeque<(i64, u64)>,
    speed: u64,
    unpack_done: u64,
    unpack_total: u64,
}

impl Row {
    fn reset(&mut self, keep_link: bool) {
        if !keep_link {
            self.link = None;
        }
        self.state = if self.link.is_some() { State::Queued } else { State::Waiting };
        self.reason = None;
        self.message = None;
        self.started = false;
        self.reused = false;
        self.received = 0;
        self.total = None;
        self.samples.clear();
        self.speed = 0;
        self.unpack_done = 0;
        self.unpack_total = 0;
    }

    fn is_open(&self) -> bool {
        !matches!(self.state, State::Done | State::Failed)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowView {
    pub id: u64,
    pub game: i64,
    pub title: String,
    pub state: State,
    pub reason: Option<Reason>,
    pub message: Option<String>,
    pub host: Option<String>,
    pub url: Option<String>,
    pub received: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub eta_secs: Option<u64>,
    pub unpack_done: u64,
    pub unpack_total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub rows: Vec<RowView>,
    pub paused: bool,
}

#[derive(Debug, Default)]
pub struct Queue {
    rows: Vec<Row>,
    next_id: u64,
    paused: bool,
}

impl Queue {
    pub fn new() -> Queue {
        Queue::default()
    }

    pub fn add(&mut self, game: i64, title: &str) -> Option<u64> {
        if let Some(position) = self.rows.iter().position(|row| row.game == game) {
            return match self.rows[position].state {
                State::Failed => {
                    self.retry(self.rows[position].id);
                    Some(self.rows[self.rows.len() - 1].id)
                }
                State::Done => {
                    self.rows.remove(position);
                    Some(self.push(game, title))
                }
                _ => None,
            };
        }
        Some(self.push(game, title))
    }

    fn push(&mut self, game: i64, title: &str) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        self.rows.push(Row {
            part: None,
            id,
            game,
            title: title.to_string(),
            state: State::Waiting,
            reason: None,
            message: None,
            link: None,
            started: false,
            reused: false,
            received: 0,
            total: None,
            samples: VecDeque::new(),
            speed: 0,
            unpack_done: 0,
            unpack_total: 0,
        });
        id
    }

    fn row_mut(&mut self, id: u64) -> Option<&mut Row> {
        self.rows.iter_mut().find(|row| row.id == id)
    }

    fn busy(&self) -> bool {
        self.rows.iter().any(|row| matches!(row.state, State::Downloading | State::Unpacking))
    }

    pub fn set_link(&mut self, id: u64, link: Link) -> Result<(), QueueError> {
        let position = self.rows.iter().position(|row| row.id == id).ok_or(QueueError::Unknown)?;
        match self.rows[position].state {
            State::Waiting | State::Queued => {}
            State::Failed => {
                let mut row = self.rows.remove(position);
                row.reset(false);
                self.rows.push(row);
                self.paused = false;
            }
            _ => return Err(QueueError::WrongState),
        }
        let row = self.row_mut(id).ok_or(QueueError::Unknown)?;
        row.link = Some(link);
        row.state = State::Queued;
        Ok(())
    }

    pub fn fail(&mut self, id: u64, reason: Reason) {
        self.fail_with_message(id, reason, reason.message());
    }

    pub fn fail_with_message(&mut self, id: u64, reason: Reason, message: &str) {
        let Some(row) = self.row_mut(id) else { return };
        if !row.is_open() {
            return;
        }
        row.state = State::Failed;
        row.reason = Some(reason);
        row.message = Some(message.to_string());
        row.speed = 0;
        row.samples.clear();
        if reason.pauses() {
            self.paused = true;
        }
    }

    pub fn take_download(&mut self) -> Option<Download> {
        let position = match self.rows.iter().position(|row| row.state == State::Downloading && !row.started) {
            Some(position) => position,
            None if self.paused || self.busy() => return None,
            None => self.rows.iter().position(|row| row.state == State::Queued)?,
        };
        let row = &mut self.rows[position];
        let link = row.link.clone()?;
        row.state = State::Downloading;
        row.started = true;
        Some(Download {
            id: row.id,
            game: row.game,
            host: link.host,
            url: link.url,
            file: link.file,
            part: row.part.clone(),
        })
    }

    pub fn progress(&mut self, id: u64, received: u64, total: Option<u64>, now_ms: i64) -> bool {
        let Some(row) = self.row_mut(id).filter(|row| row.state == State::Downloading) else {
            return false;
        };
        row.received = received;
        row.total = total;
        row.samples.push_back((now_ms, received));
        while row.samples.len() > 1 && now_ms - row.samples[0].0 > SPEED_WINDOW_MS {
            row.samples.pop_front();
        }
        row.speed = match (row.samples.front(), row.samples.back()) {
            (Some(&(t0, r0)), Some(&(t1, r1))) if t1 > t0 => (r1.saturating_sub(r0)).saturating_mul(1000) / (t1 - t0) as u64,
            _ => 0,
        };
        true
    }

    pub fn start_unpack(&mut self, id: u64) -> bool {
        let Some(row) = self.row_mut(id).filter(|row| row.state == State::Downloading) else {
            return false;
        };
        row.state = State::Unpacking;
        row.speed = 0;
        row.samples.clear();
        if let Some(total) = row.total {
            row.received = total;
        }
        true
    }

    pub fn unpack_progress(&mut self, id: u64, done: u64, total: u64) -> bool {
        let Some(row) = self.row_mut(id).filter(|row| row.state == State::Unpacking) else {
            return false;
        };
        row.unpack_done = done;
        row.unpack_total = total;
        true
    }

    pub fn finish(&mut self, id: u64) {
        if let Some(row) = self.row_mut(id).filter(|row| row.state == State::Unpacking) {
            row.state = State::Done;
            row.speed = 0;
        }
    }

    pub fn cancel(&mut self, id: u64) -> Option<State> {
        let position = self.rows.iter().position(|row| row.id == id)?;
        let removed = self.rows.remove(position);
        if self.paused && !self.rows.iter().any(|row| row.reason.is_some_and(Reason::pauses)) {
            self.paused = false;
        }
        Some(removed.state)
    }

    pub fn retry(&mut self, id: u64) -> bool {
        let Some(position) = self.rows.iter().position(|row| row.id == id && row.state == State::Failed) else {
            return false;
        };
        let mut row = self.rows.remove(position);
        let keep_link = !row.reason.is_some_and(Reason::drops_link);
        row.reset(keep_link);
        self.rows.push(row);
        self.paused = false;
        true
    }

    pub fn can_reuse_archive(&self, id: u64) -> bool {
        self.rows.iter().any(|row| {
            row.id == id
                && row.state == State::Failed
                && row.reason == Some(Reason::Unpack)
                && row.part.is_some()
                && row.link.is_some()
                && !row.reused
        })
    }

    pub fn retry_unpack(&mut self, id: u64) -> bool {
        if !self.can_reuse_archive(id) {
            return false;
        }
        let Some(position) = self.rows.iter().position(|row| row.id == id) else {
            return false;
        };
        let mut row = self.rows.remove(position);
        row.state = State::Downloading;
        row.reason = None;
        row.message = None;
        row.started = false;
        row.reused = true;
        row.samples.clear();
        row.speed = 0;
        row.unpack_done = 0;
        row.unpack_total = 0;
        self.rows.push(row);
        self.paused = false;
        true
    }

    pub fn dismiss_done(&mut self) {
        self.rows.retain(|row| row.state != State::Done);
    }

    pub fn set_part(&mut self, id: u64, part: Option<Part>) {
        if let Some(row) = self.row_mut(id) {
            row.part = part;
        }
    }

    pub fn part_of(&self, id: u64) -> Option<Part> {
        self.rows.iter().find(|row| row.id == id).and_then(|row| row.part.clone())
    }

    pub fn reason_of(&self, id: u64) -> Option<Reason> {
        self.rows.iter().find(|row| row.id == id).and_then(|row| row.reason)
    }

    pub fn saved(&self) -> Vec<Saved> {
        self.rows
            .iter()
            .filter(|row| row.state != State::Done)
            .map(|row| Saved {
                game: row.game,
                failed: row.state == State::Failed,
                reason: if row.state == State::Failed { row.reason } else { None },
                part: row.part.clone(),
                link: row.link.as_ref().map(|link| link.url.clone()),
            })
            .collect()
    }

    pub fn part_dirs(&self) -> Vec<String> {
        self.rows.iter().filter_map(|row| row.part.as_ref().map(|part| part.dir.clone())).collect()
    }

    pub fn restore(&mut self, saved: Vec<Saved>, mut title_of: impl FnMut(i64) -> Option<String>) {
        for item in saved {
            if self.rows.iter().any(|row| row.game == item.game) {
                continue;
            }
            let Some(title) = title_of(item.game) else { continue };
            let id = self.push(item.game, &title);
            let link = item.link.as_deref().and_then(|url| download_hosts::parse_link(url).ok());
            if let Some(row) = self.row_mut(id) {
                row.part = item.part;
                if let Some(link) = link {
                    row.link = Some(link);
                    row.state = State::Queued;
                }
            }
            if item.failed {
                self.fail(id, item.reason.unwrap_or(Reason::Other));
            }
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn snapshot(&self) -> Snapshot {
        let rows = self
            .rows
            .iter()
            .map(|row| RowView {
                id: row.id,
                game: row.game,
                title: row.title.clone(),
                state: row.state,
                reason: row.reason,
                message: row.message.clone(),
                host: row.link.as_ref().map(|link| link.host.clone()),
                url: row.link.as_ref().map(|link| link.url.clone()),
                received: row.received,
                total: row.total,
                speed: row.speed,
                eta_secs: match (row.state, row.total) {
                    (State::Downloading, Some(total)) if row.speed > 0 => Some(total.saturating_sub(row.received).div_ceil(row.speed)),
                    _ => None,
                },
                unpack_done: row.unpack_done,
                unpack_total: row.unpack_total,
            })
            .collect();
        Snapshot { rows, paused: self.paused }
    }
}

pub fn save_queue(conn: &rusqlite::Connection, items: &[Saved]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM download_queue", [])?;
    {
        let mut insert = tx.prepare(
            "INSERT OR REPLACE INTO download_queue (game_id, pos, state, reason, part_dir, part_name, part_total, link)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for (pos, item) in items.iter().enumerate() {
            insert.execute(rusqlite::params![
                item.game,
                pos as i64,
                if item.failed { "failed" } else { "queued" },
                item.reason.map(Reason::code),
                item.part.as_ref().map(|part| part.dir.as_str()),
                item.part.as_ref().map(|part| part.name.as_str()),
                item.part.as_ref().and_then(|part| part.total).map(|total| total as i64),
                item.link.as_deref(),
            ])?;
        }
    }
    tx.commit()
}

pub fn load_queue(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<Saved>> {
    let mut statement = conn.prepare(
        "SELECT game_id, state, reason, part_dir, part_name, part_total, link FROM download_queue ORDER BY pos",
    )?;
    let rows = statement.query_map([], |row| {
        let dir: Option<String> = row.get(3)?;
        let name: Option<String> = row.get(4)?;
        let total: Option<i64> = row.get(5)?;
        let reason: Option<String> = row.get(2)?;
        Ok(Saved {
            game: row.get(0)?,
            failed: row.get::<_, String>(1)? == "failed",
            reason: reason.as_deref().and_then(Reason::from_code),
            part: dir.zip(name).map(|(dir, name)| Part { dir, name, total: total.map(|total| total as u64) }),
            link: row.get(6)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PIXEL: &str = "https://pixeldrain.com/u/abc";

    fn part(total: Option<u64>) -> Part {
        Part { dir: ".booked-download-1".to_string(), name: "game.zip".to_string(), total }
    }

    fn link(url: &str) -> Link {
        download_hosts::parse_link(url).unwrap()
    }

    fn saved(game: i64, failed: bool, reason: Option<Reason>, link: Option<&str>) -> Saved {
        Saved { game, failed, reason, part: None, link: link.map(str::to_string) }
    }

    fn queue_with(titles: &[&str]) -> Queue {
        let mut queue = Queue::new();
        for (index, title) in titles.iter().enumerate() {
            queue.add(index as i64 + 1, title).unwrap();
        }
        queue
    }

    fn started(titles: &[&str]) -> Queue {
        let mut queue = queue_with(titles);
        queue.set_link(1, link(PIXEL)).unwrap();
        queue.take_download().unwrap();
        queue
    }

    fn state_of(queue: &Queue, id: u64) -> State {
        queue.snapshot().rows.iter().find(|row| row.id == id).unwrap().state
    }

    #[test]
    fn parse_content_range_accepts_only_sane_values() {
        assert_eq!(parse_content_range("bytes 100-199/200"), Some(ContentRange { start: 100, end: 199, total: 200 }));
        assert_eq!(parse_content_range(" bytes 0-0/1 "), Some(ContentRange { start: 0, end: 0, total: 1 }));
        assert_eq!(parse_content_range("bytes */200"), None);
        assert_eq!(parse_content_range("bytes 100-199/*"), None);
        assert_eq!(parse_content_range("bytes 200-100/300"), None);
        assert_eq!(parse_content_range("bytes 0-300/300"), None);
        assert_eq!(parse_content_range("items 0-1/2"), None);
        assert_eq!(parse_content_range(""), None);
    }

    #[test]
    fn resume_appends_only_on_exact_match() {
        assert_eq!(resume_decision(100, Some(200), 206, Some("bytes 100-199/200")), Resume::Append(100));
        assert_eq!(resume_decision(100, Some(200), 200, Some("bytes 100-199/200")), Resume::Restart);
        assert_eq!(resume_decision(100, Some(200), 206, None), Resume::Restart);
        assert_eq!(resume_decision(100, Some(300), 206, Some("bytes 100-199/200")), Resume::Restart);
        assert_eq!(resume_decision(100, None, 206, Some("bytes 100-199/200")), Resume::Restart);
        assert_eq!(resume_decision(50, Some(200), 206, Some("bytes 100-199/200")), Resume::Restart);
        assert_eq!(resume_decision(100, Some(200), 206, Some("bytes 100-149/200")), Resume::Restart);
        assert_eq!(resume_decision(0, Some(200), 206, Some("bytes 0-199/200")), Resume::Restart);
    }

    #[test]
    fn new_rows_wait_for_a_link_and_nothing_starts_without_one() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        assert_eq!(state_of(&queue, 1), State::Waiting);
        assert_eq!(queue.take_download(), None);
        queue.set_link(2, link(PIXEL)).unwrap();
        let download = queue.take_download().unwrap();
        assert_eq!((download.id, download.host.as_str(), download.url.as_str()), (2, "PIXELDRAIN", PIXEL));
        assert_eq!(state_of(&queue, 1), State::Waiting);
    }

    #[test]
    fn links_can_be_given_ahead_and_rows_go_one_at_a_time() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.set_link(1, link(PIXEL)).unwrap();
        queue.set_link(2, link("https://cdn.example.net/b.zip")).unwrap();
        assert_eq!(queue.take_download().unwrap().id, 1);
        assert_eq!(queue.take_download(), None);
        assert_eq!(state_of(&queue, 2), State::Queued);
        queue.start_unpack(1);
        assert_eq!(queue.take_download(), None);
        queue.finish(1);
        let second = queue.take_download().unwrap();
        assert_eq!(second.file.as_deref(), Some("https://cdn.example.net/b.zip"));
    }

    #[test]
    fn set_link_replaces_a_queued_link_and_refuses_a_running_row() {
        let mut queue = started(&["Первая", "Вторая"]);
        assert_eq!(queue.set_link(1, link(PIXEL)), Err(QueueError::WrongState));
        assert_eq!(queue.set_link(9, link(PIXEL)), Err(QueueError::Unknown));
        queue.set_link(2, link(PIXEL)).unwrap();
        queue.set_link(2, link("https://www.mediafire.com/file/x/b.zip/file")).unwrap();
        assert_eq!(queue.snapshot().rows[1].host.as_deref(), Some("MEDIAFIRE"));
    }

    #[test]
    fn a_new_link_for_a_failed_row_requeues_it_at_the_end() {
        let mut queue = started(&["Первая", "Вторая"]);
        queue.fail(1, Reason::Expired);
        queue.set_link(1, link("https://pixeldrain.com/u/new")).unwrap();
        let rows = queue.snapshot().rows;
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!((rows[1].state, rows[1].reason, rows[1].url.as_deref()), (State::Queued, None, Some("https://pixeldrain.com/u/new")));
    }

    #[test]
    fn retry_keeps_the_link_unless_it_went_bad() {
        let mut queue = started(&["Первая"]);
        queue.fail(1, Reason::Network);
        assert!(queue.retry(1));
        assert_eq!(state_of(&queue, 1), State::Queued);
        queue.take_download().unwrap();
        queue.fail(1, Reason::Expired);
        assert!(queue.retry(1));
        let row = queue.snapshot().rows.remove(0);
        assert_eq!((row.state, row.url), (State::Waiting, None));
    }

    #[test]
    fn restore_keeps_order_links_states_and_parts_and_drops_missing_games() {
        let mut items = vec![
            saved(3, false, None, Some(PIXEL)),
            saved(7, false, None, None),
            saved(5, true, Some(Reason::Network), Some(PIXEL)),
            saved(9, true, Some(Reason::Limit), None),
            saved(4, false, None, Some("https://f95zone.to/threads/1/")),
        ];
        items[0].part = Some(part(Some(500)));
        items[2].part = Some(part(Some(900)));
        let mut queue = Queue::new();
        queue.restore(items, |game| (game != 7).then(|| format!("Игра {game}")));
        let snapshot = queue.snapshot();
        let games: Vec<i64> = snapshot.rows.iter().map(|row| row.game).collect();
        assert_eq!(games, vec![3, 5, 9, 4]);
        assert_eq!(snapshot.rows[0].state, State::Queued);
        assert_eq!(snapshot.rows[0].title, "Игра 3");
        assert_eq!((snapshot.rows[1].state, snapshot.rows[1].reason), (State::Failed, Some(Reason::Network)));
        assert_eq!(snapshot.rows[2].reason, Some(Reason::Limit));
        assert_eq!(snapshot.rows[3].state, State::Waiting);
        assert!(snapshot.paused);
        assert_eq!(queue.part_of(snapshot.rows[0].id), Some(part(Some(500))));
        assert_eq!(queue.part_dirs().len(), 2);
        assert!(queue.retry(snapshot.rows[1].id));
        assert_eq!(state_of(&queue, snapshot.rows[1].id), State::Queued);
    }

    #[test]
    fn restore_skips_duplicates_and_reads_old_reasons_as_other() {
        let items = vec![saved(1, false, None, None), saved(1, false, None, None), saved(2, true, None, None)];
        let mut queue = Queue::new();
        queue.restore(items, |game| Some(format!("Игра {game}")));
        let rows = queue.snapshot().rows;
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[1].state, rows[1].reason), (State::Failed, Some(Reason::Other)));
        assert_eq!(Reason::from_code("captcha"), None);
    }

    #[test]
    fn retry_after_failed_unpack_reuses_the_archive_once() {
        let mut queue = started(&["Первая"]);
        queue.set_part(1, Some(part(Some(10))));
        assert!(queue.start_unpack(1));
        queue.fail(1, Reason::Unpack);
        assert!(queue.retry_unpack(1));
        let job = queue.take_download().unwrap();
        assert_eq!(job.part, Some(part(Some(10))));
        assert!(queue.start_unpack(1));
        queue.fail(1, Reason::Unpack);
        assert!(!queue.retry_unpack(1));
        assert!(queue.retry(1));
        assert_eq!(state_of(&queue, 1), State::Queued);
    }

    #[test]
    fn retry_unpack_needs_an_unpack_failure_with_a_kept_archive() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.set_part(1, Some(part(Some(10))));
        queue.fail(1, Reason::Network);
        queue.fail(2, Reason::Unpack);
        assert!(!queue.retry_unpack(1));
        assert!(!queue.retry_unpack(2));
    }

    #[test]
    fn saved_skips_done_and_round_trips_through_the_database() {
        let mut queue = started(&["Первая", "Вторая", "Третья"]);
        queue.set_part(1, Some(part(Some(10))));
        queue.start_unpack(1);
        queue.finish(1);
        queue.set_link(2, link("https://cdn.example.net/b.zip")).unwrap();
        queue.fail(3, Reason::Expired);
        let saved = queue.saved();
        assert_eq!(saved.iter().map(|item| item.game).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(saved[0].link.as_deref(), Some("https://cdn.example.net/b.zip"));

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let mut with_part = saved.clone();
        with_part[0].part = Some(part(None));
        save_queue(&conn, &with_part).unwrap();
        assert_eq!(load_queue(&conn).unwrap(), with_part);
        save_queue(&conn, &saved[1..]).unwrap();
        assert_eq!(load_queue(&conn).unwrap(), saved[1..].to_vec());
    }

    #[test]
    fn retry_keeps_the_partial_file_and_cancel_forgets_the_row() {
        let mut queue = started(&["Первая"]);
        queue.set_part(1, Some(part(Some(10))));
        queue.fail(1, Reason::Network);
        assert!(queue.retry(1));
        assert_eq!(queue.take_download().unwrap().part, Some(part(Some(10))));
        queue.cancel(1);
        assert!(queue.saved().is_empty());
    }

    #[test]
    fn reason_codes_round_trip() {
        for reason in [
            Reason::Limit, Reason::Expired, Reason::Other, Reason::Network, Reason::NotArchive, Reason::NoSpace, Reason::Unpack,
        ] {
            assert_eq!(Reason::from_code(reason.code()), Some(reason));
            assert!(!reason.message().is_empty());
        }
        assert_eq!(Reason::from_code("zzz"), None);
    }

    #[test]
    fn add_rejects_duplicates() {
        let mut queue = queue_with(&["Тёмный лес"]);
        assert_eq!(queue.add(1, "Тёмный лес"), None);
        assert_eq!(queue.snapshot().rows.len(), 1);
    }

    #[test]
    fn add_of_failed_game_retries_it_at_the_end() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.fail(1, Reason::Network);
        assert_eq!(queue.add(1, "Первая"), Some(1));
        let rows = queue.snapshot().rows;
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!((rows[1].state, rows[1].reason), (State::Waiting, None));
    }

    #[test]
    fn add_of_done_game_replaces_the_old_row() {
        let mut queue = started(&["Первая"]);
        queue.start_unpack(1);
        queue.finish(1);
        let id = queue.add(1, "Первая").unwrap();
        assert_ne!(id, 1);
        assert_eq!(queue.snapshot().rows.len(), 1);
    }

    #[test]
    fn take_download_gives_each_row_once() {
        let mut queue = started(&["Первая"]);
        assert_eq!(state_of(&queue, 1), State::Downloading);
        assert_eq!(queue.take_download(), None);
    }

    #[test]
    fn limit_pauses_until_a_retry_or_cancel_of_the_cause() {
        let mut queue = started(&["Первая", "Вторая"]);
        queue.set_link(2, link(PIXEL)).unwrap();
        queue.fail(1, Reason::Limit);
        assert!(queue.is_paused());
        assert_eq!(queue.take_download(), None);
        assert_eq!(queue.cancel(1), Some(State::Failed));
        assert!(!queue.is_paused());
        assert_eq!(queue.take_download().unwrap().id, 2);
    }

    #[test]
    fn plain_failure_does_not_pause() {
        let mut queue = started(&["Первая", "Вторая"]);
        queue.set_link(2, link(PIXEL)).unwrap();
        queue.fail(1, Reason::Expired);
        assert!(!queue.is_paused());
        let row = queue.snapshot().rows.remove(0);
        assert_eq!(row.message.as_deref(), Some(Reason::Expired.message()));
        assert_eq!(queue.take_download().unwrap().id, 2);
    }

    #[test]
    fn speed_is_a_three_second_moving_average() {
        let mut queue = started(&["Первая"]);
        queue.progress(1, 0, Some(10_000), 0);
        queue.progress(1, 1000, Some(10_000), 1000);
        queue.progress(1, 2000, Some(10_000), 2000);
        queue.progress(1, 3000, Some(10_000), 3000);
        assert_eq!(queue.snapshot().rows[0].speed, 1000);
        queue.progress(1, 13_000, Some(20_000), 4000);
        queue.progress(1, 23_000, Some(40_000), 5000);
        let row = queue.snapshot().rows.remove(0);
        assert_eq!(row.speed, 7000);
        assert_eq!(row.eta_secs, Some(3));
    }

    #[test]
    fn eta_is_unknown_without_total_or_speed() {
        let mut queue = started(&["Первая"]);
        queue.progress(1, 100, None, 0);
        queue.progress(1, 200, None, 1000);
        let row = queue.snapshot().rows.remove(0);
        assert_eq!(row.speed, 100);
        assert_eq!(row.total, None);
        assert_eq!(row.eta_secs, None);
    }

    #[test]
    fn progress_ignores_rows_that_are_not_downloading() {
        let mut queue = queue_with(&["Первая"]);
        assert!(!queue.progress(1, 10, None, 0));
        assert!(!queue.progress(5, 10, None, 0));
    }

    #[test]
    fn unpack_flow_reaches_done_and_dismiss_removes_it() {
        let mut queue = started(&["Первая", "Вторая"]);
        assert!(queue.start_unpack(1));
        assert!(queue.unpack_progress(1, 40, 100));
        let row = queue.snapshot().rows.remove(0);
        assert_eq!((row.state, row.unpack_done, row.unpack_total), (State::Unpacking, 40, 100));
        queue.finish(1);
        assert_eq!(state_of(&queue, 1), State::Done);
        queue.dismiss_done();
        assert_eq!(queue.snapshot().rows.len(), 1);
    }

    #[test]
    fn cancel_removes_from_any_state_and_reports_it() {
        let mut queue = started(&["Первая", "Вторая", "Третья"]);
        assert_eq!(queue.cancel(1), Some(State::Downloading));
        assert_eq!(queue.cancel(3), Some(State::Waiting));
        assert_eq!(queue.cancel(3), None);
        assert_eq!(queue.snapshot().rows.len(), 1);
    }

    #[test]
    fn retry_only_works_for_failed_rows() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        assert!(!queue.retry(1));
        queue.fail(1, Reason::Network);
        assert!(queue.retry(1));
        let rows = queue.snapshot().rows;
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), vec![2, 1]);
    }

    #[test]
    fn snapshot_serializes_in_camel_case_with_kebab_values() {
        let mut queue = queue_with(&["Первая"]);
        queue.fail(1, Reason::NotArchive);
        let json = serde_json::to_value(queue.snapshot()).unwrap();
        assert_eq!(json["paused"], false);
        assert_eq!(json["rows"][0]["state"], "failed");
        assert_eq!(json["rows"][0]["reason"], "not-archive");
        assert!(json["rows"][0].get("etaSecs").is_some());
        assert!(json["rows"][0].get("unpackDone").is_some());
    }
}
