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
            Reason::Unpack => "Не удалось распаковать архив — скачай его заново.",
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
pub struct Download {
    pub id: u64,
    pub game: i64,
    pub title: String,
    pub host: String,
    pub url: String,
}

#[derive(Debug, Clone)]
struct Row {
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
    started: bool,
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
        self.started = false;
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
            started: false,
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
        let row = self.row_mut(id).ok_or(QueueError::Unknown)?;
        if row.state != State::Resolving {
            return Err(QueueError::WrongState);
        }
        let host = download_hosts::normalize_host(host);
        if !row.hosts.contains(&host) || !download_hosts::url_matches_host(&host, url) {
            return Err(QueueError::BadLink);
        }
        row.state = State::Downloading;
        row.host = Some(host);
        row.url = Some(url.to_string());
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

    pub fn dismiss_done(&mut self) {
        self.rows.retain(|row| row.state != State::Done);
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let mut queue = queue_with(&["Первая"]);
        assert_eq!(queue.resolved(1, "PIXELDRAIN", "https://pixeldrain.com/u/a"), Err(QueueError::WrongState));
        assert_eq!(queue.resolved(9, "PIXELDRAIN", "https://pixeldrain.com/u/a"), Err(QueueError::Unknown));
        queue.next_for_bridge(0);
        assert_eq!(queue.resolved(1, "BUZZHEAVIER", "https://buzzheavier.com/abc"), Err(QueueError::BadLink));
        assert_eq!(queue.resolved(1, "PIXELDRAIN", "https://evil.example/u/a"), Err(QueueError::BadLink));
        assert_eq!(queue.resolved(1, "PIXELDRAIN", "http://pixeldrain.com/u/a"), Err(QueueError::BadLink));
        assert_eq!(queue.resolved(1, " pixeldrain ", "https://pixeldrain.com/u/a"), Ok(()));
        let row = queue.snapshot(0).rows.remove(0);
        assert_eq!(row.state, State::Downloading);
        assert_eq!(row.host.as_deref(), Some("PIXELDRAIN"));
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
