use std::collections::VecDeque;

use serde::Serialize;

use crate::download_hosts;

pub const SPEED_WINDOW_MS: i64 = 3000;
pub const STALL_AFTER_MS: i64 = 120_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Waiting,
    Resolving,
    Downloading,
    Unpacking,
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    Captcha,
    Limit,
    Expired,
    Login,
    NoHost,
    Other,
    Network,
    NotArchive,
    NoSpace,
    Bridge,
    Unpack,
    CloudKey,
}

impl Reason {
    pub fn from_bridge(code: &str) -> Option<Reason> {
        match code {
            "captcha" => Some(Reason::Captcha),
            "limit" => Some(Reason::Limit),
            "expired" => Some(Reason::Expired),
            "login" => Some(Reason::Login),
            "no-host" => Some(Reason::NoHost),
            "other" => Some(Reason::Other),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Reason::Captcha => "captcha",
            Reason::Limit => "limit",
            Reason::Expired => "expired",
            Reason::Login => "login",
            Reason::NoHost => "no-host",
            Reason::Other => "other",
            Reason::Network => "network",
            Reason::NotArchive => "not-archive",
            Reason::NoSpace => "no-space",
            Reason::Bridge => "bridge",
            Reason::Unpack => "unpack",
            Reason::CloudKey => "cloud-key",
        }
    }

    pub fn from_code(code: &str) -> Option<Reason> {
        Some(match code {
            "captcha" => Reason::Captcha,
            "limit" => Reason::Limit,
            "expired" => Reason::Expired,
            "login" => Reason::Login,
            "no-host" => Reason::NoHost,
            "other" => Reason::Other,
            "network" => Reason::Network,
            "not-archive" => Reason::NotArchive,
            "no-space" => Reason::NoSpace,
            "bridge" => Reason::Bridge,
            "unpack" => Reason::Unpack,
            "cloud-key" => Reason::CloudKey,
            _ => return None,
        })
    }

    pub fn message(self) -> &'static str {
        match self {
            Reason::Captcha => "Форум просит капчу — пройди её в браузере и нажми «Повторить»",
            Reason::Limit => "Дневной лимит скачивания исчерпан — нажми «Повторить» позже",
            Reason::Expired => "Ссылка устарела или файл удалён — нажми «Повторить», чтобы взять новую.",
            Reason::Login => "Нет входа на форум — войди в аккаунт в браузере и нажми «Повторить»",
            Reason::NoHost => "На странице игры нет ссылок на поддерживаемые файлообменники.",
            Reason::Other => "Не удалось получить ссылку на скачивание — нажми «Повторить»",
            Reason::Network => "Соединение оборвалось — нажми «Повторить».",
            Reason::NotArchive => "Это не архив — Booked принимает файлы .zip, .7z и .rar.",
            Reason::NoSpace => "Не хватает места на диске с играми — освободи место и нажми «Повторить»",
            Reason::Bridge => "Booked не смог открыть порт для расширения — возможно, его занимает другая программа. Закрой её и перезапусти Booked",
            Reason::Unpack => "Не удалось распаковать архив — нажми «Повторить»",
            Reason::CloudKey => "Подключи облако в настройках — без ключа Booked не свяжется с расширением Sorter 95.",
        }
    }

    fn pauses(self) -> bool {
        matches!(self, Reason::Captcha | Reason::Limit)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueError {
    Unknown,
    WrongState,
    BadLink,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: u64,
    pub thread: i64,
    pub title: String,
    pub hosts: Vec<String>,
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
    pub title: String,
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Known {
    pub thread: i64,
    pub title: String,
    pub hosts: Vec<String>,
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
    thread: i64,
    title: String,
    hosts: Vec<String>,
    state: State,
    reason: Option<Reason>,
    message: Option<String>,
    host: Option<String>,
    url: Option<String>,
    file: Option<String>,
    started: bool,
    reused: bool,
    received: u64,
    total: Option<u64>,
    samples: VecDeque<(i64, u64)>,
    speed: u64,
    unpack_done: u64,
    unpack_total: u64,
    waiting_since_ms: i64,
}

impl Row {
    fn reset(&mut self, now_ms: i64) {
        self.state = State::Waiting;
        self.reason = None;
        self.message = None;
        self.host = None;
        self.url = None;
        self.file = None;
        self.started = false;
        self.reused = false;
        self.received = 0;
        self.total = None;
        self.samples.clear();
        self.speed = 0;
        self.unpack_done = 0;
        self.unpack_total = 0;
        self.waiting_since_ms = now_ms;
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
    pub thread: i64,
    pub title: String,
    pub hosts: Vec<String>,
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
    pub stalled: bool,
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
    last_poll_ms: Option<i64>,
}

impl Queue {
    pub fn new() -> Queue {
        Queue::default()
    }

    pub fn add(&mut self, game: i64, thread: i64, title: &str, hosts: Vec<String>, now_ms: i64) -> Option<u64> {
        if hosts.is_empty() {
            return None;
        }
        if let Some(position) = self.rows.iter().position(|row| row.game == game) {
            return match self.rows[position].state {
                State::Failed => {
                    self.retry(self.rows[position].id, now_ms);
                    Some(self.rows[self.rows.len() - 1].id)
                }
                State::Done => {
                    self.rows.remove(position);
                    Some(self.push(game, thread, title, hosts, now_ms))
                }
                _ => None,
            };
        }
        Some(self.push(game, thread, title, hosts, now_ms))
    }

    fn push(&mut self, game: i64, thread: i64, title: &str, hosts: Vec<String>, now_ms: i64) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        self.rows.push(Row {
            part: None,
            id,
            game,
            thread,
            title: title.to_string(),
            hosts,
            state: State::Waiting,
            reason: None,
            message: None,
            host: None,
            url: None,
            file: None,
            started: false,
            reused: false,
            received: 0,
            total: None,
            samples: VecDeque::new(),
            speed: 0,
            unpack_done: 0,
            unpack_total: 0,
            waiting_since_ms: now_ms,
        });
        id
    }

    fn row_mut(&mut self, id: u64) -> Option<&mut Row> {
        self.rows.iter_mut().find(|row| row.id == id)
    }

    fn busy(&self) -> bool {
        self.rows.iter().any(|row| matches!(row.state, State::Downloading | State::Unpacking))
    }

    pub fn next_for_bridge(&mut self, now_ms: i64) -> Option<Job> {
        self.last_poll_ms = Some(now_ms);
        if self.paused {
            return None;
        }
        let position = match self.rows.iter().position(|row| row.state == State::Resolving) {
            Some(position) => position,
            None => {
                if self.busy() {
                    return None;
                }
                let position = self.rows.iter().position(|row| row.state == State::Waiting)?;
                self.rows[position].state = State::Resolving;
                position
            }
        };
        let row = &self.rows[position];
        Some(Job { id: row.id, thread: row.thread, title: row.title.clone(), hosts: row.hosts.clone() })
    }

    pub fn resolved(&mut self, id: u64, host: &str, url: &str) -> Result<(), QueueError> {
        self.resolved_file(id, host, url, None)
    }

    pub fn resolved_file(&mut self, id: u64, host: &str, url: &str, file: Option<&str>) -> Result<(), QueueError> {
        let row = self.row_mut(id).ok_or(QueueError::Unknown)?;
        if row.state != State::Resolving {
            return Err(QueueError::WrongState);
        }
        let host = download_hosts::normalize_host(host);
        let file = file
            .map(str::trim)
            .filter(|file| !file.is_empty() && download_hosts::needs_file(&host));
        let file_ok = match file {
            Some(file) => download_hosts::file_url_ok(file),
            None => !download_hosts::needs_file(&host),
        };
        if !row.hosts.contains(&host) || !download_hosts::url_matches_host(&host, url) || !file_ok {
            self.fail_with_message(id, Reason::Other, "Booked не скачивает с этого файлообменника — скачай игру вручную");
            return Err(QueueError::BadLink);
        }
        row.state = State::Downloading;
        row.host = Some(host);
        row.url = Some(url.to_string());
        row.file = file.map(str::to_string);
        row.started = false;
        Ok(())
    }

    pub fn failed(&mut self, id: u64, reason: Reason) -> Result<(), QueueError> {
        let row = self.row_mut(id).ok_or(QueueError::Unknown)?;
        if row.state != State::Resolving {
            return Err(QueueError::WrongState);
        }
        self.fail(id, reason);
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
        let row = self.rows.iter_mut().find(|row| row.state == State::Downloading && !row.started)?;
        row.started = true;
        Some(Download {
            id: row.id,
            game: row.game,
            title: row.title.clone(),
            host: row.host.clone().unwrap_or_default(),
            url: row.url.clone().unwrap_or_default(),
            file: row.file.clone(),
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

    pub fn retry(&mut self, id: u64, now_ms: i64) -> bool {
        let Some(position) = self.rows.iter().position(|row| row.id == id && row.state == State::Failed) else {
            return false;
        };
        let mut row = self.rows.remove(position);
        row.reset(now_ms);
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
            })
            .collect()
    }

    pub fn part_dirs(&self) -> Vec<String> {
        self.rows.iter().filter_map(|row| row.part.as_ref().map(|part| part.dir.clone())).collect()
    }

    pub fn restore(&mut self, saved: Vec<Saved>, mut lookup: impl FnMut(i64) -> Option<Known>, now_ms: i64) {
        for item in saved {
            if self.rows.iter().any(|row| row.game == item.game) {
                continue;
            }
            let Some(known) = lookup(item.game) else { continue };
            let no_hosts = known.hosts.is_empty();
            let id = self.push(item.game, known.thread, &known.title, known.hosts, now_ms);
            let reason = item.reason.filter(|_| item.failed).unwrap_or(Reason::Other);
            if let Some(row) = self.row_mut(id) {
                row.part = item.part;
            }
            if no_hosts {
                self.fail(id, Reason::NoHost);
            } else if item.failed {
                self.fail(id, reason);
            }
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn snapshot(&self, now_ms: i64) -> Snapshot {
        let mut blocked_ahead = false;
        let mut rows = Vec::with_capacity(self.rows.len());
        for row in &self.rows {
            let needs_link = row.state == State::Resolving || (row.state == State::Waiting && !blocked_ahead && !self.busy() && !self.paused);
            let silent_since = self.last_poll_ms.unwrap_or(0).max(row.waiting_since_ms);
            let stalled = needs_link && now_ms - silent_since >= STALL_AFTER_MS;
            if row.is_open() {
                blocked_ahead = true;
            }
            let eta_secs = match (row.state, row.total) {
                (State::Downloading, Some(total)) if row.speed > 0 => Some(total.saturating_sub(row.received).div_ceil(row.speed)),
                _ => None,
            };
            rows.push(RowView {
                id: row.id,
                game: row.game,
                thread: row.thread,
                title: row.title.clone(),
                hosts: row.hosts.clone(),
                state: row.state,
                reason: row.reason,
                message: row.message.clone(),
                host: row.host.clone(),
                url: row.url.clone(),
                received: row.received,
                total: row.total,
                speed: row.speed,
                eta_secs,
                unpack_done: row.unpack_done,
                unpack_total: row.unpack_total,
                stalled,
            });
        }
        Snapshot { rows, paused: self.paused }
    }
}

pub fn save_queue(conn: &rusqlite::Connection, items: &[Saved]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM download_queue", [])?;
    {
        let mut insert = tx.prepare(
            "INSERT OR REPLACE INTO download_queue (game_id, pos, state, reason, part_dir, part_name, part_total)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
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
            ])?;
        }
    }
    tx.commit()
}

pub fn load_queue(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<Saved>> {
    let mut statement = conn.prepare(
        "SELECT game_id, state, reason, part_dir, part_name, part_total FROM download_queue ORDER BY pos",
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
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(thread: i64) -> Known {
        Known { thread, title: format!("Игра {thread}"), hosts: hosts() }
    }

    fn part(total: Option<u64>) -> Part {
        Part { dir: ".booked-download-1".to_string(), name: "game.zip".to_string(), total }
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
    fn restore_keeps_order_states_and_parts_and_drops_missing_games() {
        let saved = vec![
            Saved { game: 3, failed: false, reason: None, part: Some(part(Some(500))) },
            Saved { game: 7, failed: false, reason: None, part: None },
            Saved { game: 5, failed: true, reason: Some(Reason::Network), part: Some(part(Some(900))) },
            Saved { game: 9, failed: true, reason: Some(Reason::Captcha), part: None },
        ];
        let mut queue = Queue::new();
        queue.restore(saved, |game| (game != 7).then(|| known(game * 10)), 0);
        let snapshot = queue.snapshot(0);
        let games: Vec<i64> = snapshot.rows.iter().map(|row| row.game).collect();
        assert_eq!(games, vec![3, 5, 9]);
        assert_eq!(snapshot.rows[0].state, State::Waiting);
        assert_eq!(snapshot.rows[0].thread, 30);
        assert_eq!(snapshot.rows[1].state, State::Failed);
        assert_eq!(snapshot.rows[1].reason, Some(Reason::Network));
        assert_eq!(snapshot.rows[2].reason, Some(Reason::Captcha));
        assert!(snapshot.paused);
        assert_eq!(queue.part_of(snapshot.rows[0].id), Some(part(Some(500))));
        assert_eq!(queue.part_of(snapshot.rows[1].id), Some(part(Some(900))));
        assert_eq!(queue.part_dirs().len(), 2);
    }

    #[test]
    fn restore_skips_duplicates_and_keeps_games_without_hosts_as_failed() {
        let saved = vec![
            Saved { game: 1, failed: false, reason: None, part: None },
            Saved { game: 1, failed: false, reason: None, part: None },
            Saved { game: 2, failed: false, reason: None, part: None },
        ];
        let mut queue = Queue::new();
        queue.restore(
            saved,
            |game| Some(Known { thread: game, title: "т".to_string(), hosts: if game == 2 { Vec::new() } else { hosts() } }),
            0,
        );
        let rows = queue.snapshot(0).rows;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].state, State::Failed);
        assert_eq!(rows[1].reason, Some(Reason::NoHost));
    }

    #[test]
    fn retry_after_failed_unpack_reuses_the_archive_once() {
        let mut queue = queue_with(&["Первая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        queue.take_download().unwrap();
        queue.set_part(1, Some(part(Some(10))));
        assert!(queue.start_unpack(1));
        queue.fail(1, Reason::Unpack);
        assert!(queue.retry_unpack(1));
        let job = queue.take_download().unwrap();
        assert_eq!(job.part, Some(part(Some(10))));
        assert_eq!(queue.next_for_bridge(0), None);
        assert!(queue.start_unpack(1));
        queue.fail(1, Reason::Unpack);
        assert!(!queue.retry_unpack(1));
        assert!(queue.retry(1, 0));
        assert_eq!(queue.snapshot(0).rows[0].state, State::Waiting);
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
        let mut queue = queue_with(&["Первая", "Вторая", "Третья"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        queue.take_download();
        queue.set_part(1, Some(part(Some(10))));
        queue.start_unpack(1);
        queue.finish(1);
        queue.fail(3, Reason::Expired);
        let saved = queue.saved();
        assert_eq!(saved.iter().map(|item| item.game).collect::<Vec<_>>(), vec![2, 3]);

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
        let mut queue = queue_with(&["Первая"]);
        queue.set_part(1, Some(part(Some(10))));
        queue.fail(1, Reason::Network);
        assert!(queue.retry(1, 5));
        assert_eq!(queue.part_of(1), Some(part(Some(10))));
        queue.next_for_bridge(6);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        assert_eq!(queue.take_download().unwrap().part, Some(part(Some(10))));
        queue.cancel(1);
        assert!(queue.saved().is_empty());
    }

    #[test]
    fn reason_codes_round_trip() {
        for reason in [
            Reason::Captcha, Reason::Limit, Reason::Expired, Reason::Login, Reason::NoHost, Reason::Other,
            Reason::Network, Reason::NotArchive, Reason::NoSpace, Reason::Bridge, Reason::Unpack, Reason::CloudKey,
        ] {
            assert_eq!(Reason::from_code(reason.code()), Some(reason));
        }
        assert_eq!(Reason::from_code("zzz"), None);
    }

    fn hosts() -> Vec<String> {
        vec!["PIXELDRAIN".to_string(), "MEDIAFIRE".to_string()]
    }

    fn queue_with(titles: &[&str]) -> Queue {
        let mut queue = Queue::new();
        for (index, title) in titles.iter().enumerate() {
            queue.add(index as i64 + 1, 100 + index as i64, title, hosts(), 0).unwrap();
        }
        queue
    }

    fn state_of(queue: &Queue, id: u64) -> State {
        queue.snapshot(0).rows.iter().find(|row| row.id == id).unwrap().state
    }

    #[test]
    fn add_rejects_duplicates_and_empty_hosts() {
        let mut queue = queue_with(&["Тёмный лес"]);
        assert_eq!(queue.add(1, 100, "Тёмный лес", hosts(), 5), None);
        assert_eq!(queue.add(2, 101, "Без хостов", Vec::new(), 5), None);
        assert_eq!(queue.snapshot(0).rows.len(), 1);
    }

    #[test]
    fn add_of_failed_game_retries_it_at_the_end() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.fail(1, Reason::Network);
        let id = queue.add(1, 100, "Первая", hosts(), 9).unwrap();
        assert_eq!(id, 1);
        let rows = queue.snapshot(9).rows;
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(rows[1].state, State::Waiting);
        assert_eq!(rows[1].reason, None);
    }

    #[test]
    fn add_of_done_game_replaces_the_old_row() {
        let mut queue = queue_with(&["Первая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "pixeldrain", "https://pixeldrain.com/u/abc").unwrap();
        queue.take_download();
        queue.start_unpack(1);
        queue.finish(1);
        let id = queue.add(1, 100, "Первая", hosts(), 3).unwrap();
        assert_ne!(id, 1);
        assert_eq!(queue.snapshot(3).rows.len(), 1);
    }

    #[test]
    fn next_for_bridge_hands_out_the_same_row_until_resolved() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        let first = queue.next_for_bridge(10).unwrap();
        assert_eq!(first.id, 1);
        assert_eq!(first.thread, 100);
        assert_eq!(first.hosts, hosts());
        assert_eq!(queue.next_for_bridge(11).unwrap().id, 1);
        assert_eq!(state_of(&queue, 1), State::Resolving);
        assert_eq!(state_of(&queue, 2), State::Waiting);
    }

    #[test]
    fn next_for_bridge_waits_while_a_download_is_running() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/abc").unwrap();
        assert_eq!(queue.next_for_bridge(1), None);
        queue.take_download();
        queue.start_unpack(1);
        assert_eq!(queue.next_for_bridge(2), None);
        queue.finish(1);
        assert_eq!(queue.next_for_bridge(3).unwrap().id, 2);
    }

    #[test]
    fn resolved_checks_state_host_and_domain() {
        let mut queue = queue_with(&["Первая", "Вторая", "Третья", "Четвёртая"]);
        assert_eq!(queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a"), Err(QueueError::WrongState));
        assert_eq!(queue.resolved(9, "PIXELDRAIN", "https://pixeldrain.com/u/a"), Err(QueueError::Unknown));
        let bad = [(1, "BUZZHEAVIER", "https://buzzheavier.com/abc"), (2, "PIXELDRAIN", "https://evil.example/u/a"), (3, "PIXELDRAIN", "http://pixeldrain.com/u/a")];
        for (id, host, url) in bad {
            assert_eq!(queue.next_for_bridge(0).unwrap().id, id);
            assert_eq!(queue.resolved(id, host, url), Err(QueueError::BadLink));
        }
        assert_eq!(queue.next_for_bridge(0).unwrap().id, 4);
        assert_eq!(queue.resolved(4, " pixeldrain ", "https://pixeldrain.com/u/a"), Ok(()));
        let rows = queue.snapshot(0).rows;
        assert!(rows[..3].iter().all(|row| row.state == State::Failed && row.reason == Some(Reason::Other)));
        assert_eq!(rows[3].state, State::Downloading);
        assert_eq!(rows[3].host.as_deref(), Some("PIXELDRAIN"));
    }

    #[test]
    fn browser_hosts_resolve_only_with_a_public_file_link() {
        let mut queue = Queue::new();
        for game in 1..=4 {
            queue.add(game, 100 + game, "Игра", vec!["DATANODES".to_string(), "BUZZHEAVIER".to_string()], 0).unwrap();
        }
        let bad: [(u64, &str, &str, Option<&str>); 3] = [
            (1, "DATANODES", "https://datanodes.to/abc/game.zip", None),
            (2, "DATANODES", "https://datanodes.to/abc/game.zip", Some("http://cdn.example.net/game.zip")),
            (3, "BUZZHEAVIER", "https://bzzhr.to/abc", Some("https://127.0.0.1/game.zip")),
        ];
        for (id, host, url, file) in bad {
            assert_eq!(queue.next_for_bridge(0).unwrap().id, id);
            assert_eq!(queue.resolved_file(id, host, url, file), Err(QueueError::BadLink));
        }
        assert_eq!(queue.next_for_bridge(0).unwrap().id, 4);
        assert_eq!(queue.resolved_file(4, "BUZZHEAVIER", "https://bzzhr.to/abc", Some(" https://cdn.example.net/game.zip ")), Ok(()));
        let download = queue.take_download().unwrap();
        assert_eq!(download.url, "https://bzzhr.to/abc");
        assert_eq!(download.file.as_deref(), Some("https://cdn.example.net/game.zip"));
    }

    #[test]
    fn hosts_without_browser_ignore_a_file_link() {
        let mut queue = queue_with(&["Первая"]);
        queue.next_for_bridge(0);
        let resolved = queue.resolved_file(1, "PIXELDRAIN", "https://pixeldrain.com/u/a", Some("https://evil.example/x.zip"));
        assert_eq!(resolved, Ok(()));
        assert_eq!(queue.take_download().unwrap().file, None);
    }

    #[test]
    fn take_download_gives_each_resolved_row_once() {
        let mut queue = queue_with(&["Первая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        let download = queue.take_download().unwrap();
        assert_eq!(download.id, 1);
        assert_eq!(download.game, 1);
        assert_eq!(download.url, "https://pixeldrain.com/u/a");
        assert_eq!(queue.take_download(), None);
    }

    #[test]
    fn captcha_pauses_until_any_retry() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.next_for_bridge(0);
        queue.failed(1, Reason::Captcha).unwrap();
        assert!(queue.is_paused());
        assert_eq!(queue.next_for_bridge(1), None);
        assert!(queue.retry(1, 2));
        assert!(!queue.is_paused());
        assert_eq!(queue.next_for_bridge(3).unwrap().id, 2);
    }

    #[test]
    fn limit_pauses_and_cancel_of_the_cause_unpauses() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.next_for_bridge(0);
        queue.failed(1, Reason::Limit).unwrap();
        assert!(queue.is_paused());
        assert_eq!(queue.cancel(1), Some(State::Failed));
        assert!(!queue.is_paused());
        assert_eq!(queue.next_for_bridge(1).unwrap().id, 2);
    }

    #[test]
    fn plain_failure_does_not_pause() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.next_for_bridge(0);
        queue.failed(1, Reason::Expired).unwrap();
        assert!(!queue.is_paused());
        let row = queue.snapshot(0).rows.remove(0);
        assert_eq!(row.message.as_deref(), Some(Reason::Expired.message()));
        assert_eq!(queue.next_for_bridge(1).unwrap().id, 2);
    }

    #[test]
    fn failed_needs_a_resolving_row() {
        let mut queue = queue_with(&["Первая"]);
        assert_eq!(queue.failed(1, Reason::Other), Err(QueueError::WrongState));
        assert_eq!(queue.failed(7, Reason::Other), Err(QueueError::Unknown));
    }

    #[test]
    fn speed_is_a_three_second_moving_average() {
        let mut queue = queue_with(&["Первая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        queue.progress(1, 0, Some(10_000), 0);
        queue.progress(1, 1000, Some(10_000), 1000);
        queue.progress(1, 2000, Some(10_000), 2000);
        queue.progress(1, 3000, Some(10_000), 3000);
        assert_eq!(queue.snapshot(3000).rows[0].speed, 1000);
        queue.progress(1, 13_000, Some(20_000), 4000);
        queue.progress(1, 23_000, Some(40_000), 5000);
        let row = queue.snapshot(5000).rows.remove(0);
        assert_eq!(row.speed, 7000);
        assert_eq!(row.eta_secs, Some(3));
    }

    #[test]
    fn eta_is_unknown_without_total_or_speed() {
        let mut queue = queue_with(&["Первая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        queue.progress(1, 100, None, 0);
        queue.progress(1, 200, None, 1000);
        let row = queue.snapshot(1000).rows.remove(0);
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
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        queue.take_download();
        assert!(queue.start_unpack(1));
        assert!(queue.unpack_progress(1, 40, 100));
        let row = queue.snapshot(0).rows.remove(0);
        assert_eq!((row.state, row.unpack_done, row.unpack_total), (State::Unpacking, 40, 100));
        queue.finish(1);
        assert_eq!(state_of(&queue, 1), State::Done);
        queue.dismiss_done();
        assert_eq!(queue.snapshot(0).rows.len(), 1);
    }

    #[test]
    fn cancel_removes_from_any_state_and_reports_it() {
        let mut queue = queue_with(&["Первая", "Вторая", "Третья"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        assert_eq!(queue.cancel(1), Some(State::Downloading));
        assert_eq!(queue.cancel(3), Some(State::Waiting));
        assert_eq!(queue.cancel(3), None);
        assert_eq!(queue.snapshot(0).rows.len(), 1);
    }

    #[test]
    fn retry_only_works_for_failed_rows() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        assert!(!queue.retry(1, 0));
        queue.fail(1, Reason::Network);
        assert!(queue.retry(1, 50));
        let rows = queue.snapshot(50).rows;
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), vec![2, 1]);
    }

    #[test]
    fn stalled_appears_when_nobody_takes_the_row_for_two_minutes() {
        let mut queue = queue_with(&["Первая"]);
        assert!(!queue.snapshot(119_000).rows[0].stalled);
        assert!(queue.snapshot(120_000).rows[0].stalled);
        queue.next_for_bridge(125_000);
        assert!(!queue.snapshot(130_000).rows[0].stalled);
        assert!(queue.snapshot(245_000).rows[0].stalled);
    }

    #[test]
    fn waiting_behind_an_active_download_is_not_stalled() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.next_for_bridge(0);
        queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a").unwrap();
        let rows = queue.snapshot(500_000).rows;
        assert!(!rows[0].stalled);
        assert!(!rows[1].stalled);
    }

    #[test]
    fn only_the_head_waiting_row_can_be_stalled() {
        let queue = queue_with(&["Первая", "Вторая"]);
        let rows = queue.snapshot(200_000).rows;
        assert!(rows[0].stalled);
        assert!(!rows[1].stalled);
    }

    #[test]
    fn snapshot_serializes_in_camel_case_with_kebab_values() {
        let mut queue = queue_with(&["Первая"]);
        queue.next_for_bridge(0);
        queue.failed(1, Reason::NoHost).unwrap();
        let json = serde_json::to_value(queue.snapshot(0)).unwrap();
        assert_eq!(json["paused"], false);
        assert_eq!(json["rows"][0]["state"], "failed");
        assert_eq!(json["rows"][0]["reason"], "no-host");
        assert!(json["rows"][0].get("etaSecs").is_some());
        assert!(json["rows"][0].get("unpackDone").is_some());
    }

    #[test]
    fn reasons_have_russian_messages_and_bridge_codes_parse() {
        for code in ["captcha", "limit", "expired", "login", "no-host", "other"] {
            assert!(Reason::from_bridge(code).is_some());
        }
        assert_eq!(Reason::from_bridge("network"), None);
        assert!(Reason::CloudKey.message().contains("облако"));
    }
}
