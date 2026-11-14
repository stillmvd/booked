use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Waiting,
    Queued,
    Unpacking,
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    Other,
    NoSpace,
    Unpack,
    Missing,
}

impl Reason {
    pub fn code(self) -> &'static str {
        match self {
            Reason::Other => "other",
            Reason::NoSpace => "no-space",
            Reason::Unpack => "unpack",
            Reason::Missing => "missing",
        }
    }

    pub fn from_code(code: &str) -> Option<Reason> {
        Some(match code {
            "other" => Reason::Other,
            "no-space" => Reason::NoSpace,
            "unpack" => Reason::Unpack,
            "missing" => Reason::Missing,
            _ => return None,
        })
    }

    pub fn message(self) -> &'static str {
        match self {
            Reason::Other => "Что-то пошло не так — нажми «Повторить»",
            Reason::NoSpace => "Не хватает места на диске с играми — освободи его и нажми «Повторить»",
            Reason::Unpack => "Не получилось распаковать архив — нажми «Повторить»",
            Reason::Missing => "Архива уже нет в папке «Загрузки» — скачай его снова, Booked подхватит",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueError {
    Unknown,
    WrongState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub id: u64,
    pub game: i64,
    pub archive: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saved {
    pub game: i64,
    pub failed: bool,
    pub reason: Option<Reason>,
    pub archive: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Clone)]
struct Row {
    id: u64,
    game: i64,
    title: String,
    state: State,
    reason: Option<Reason>,
    message: Option<String>,
    archive: Option<PathBuf>,
    added_at: i64,
    unpack_done: u64,
    unpack_total: u64,
}

impl Row {
    fn is_open(&self) -> bool {
        !matches!(self.state, State::Done | State::Failed)
    }
}

#[derive(Debug, Clone)]
struct Unclaimed {
    id: u64,
    path: PathBuf,
    candidates: Vec<i64>,
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
    pub archive_name: Option<String>,
    pub unpack_done: u64,
    pub unpack_total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnclaimedView {
    pub id: u64,
    pub name: String,
    pub options: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub rows: Vec<RowView>,
    pub unclaimed: Vec<UnclaimedView>,
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default()
}

#[derive(Debug, Default)]
pub struct Queue {
    rows: Vec<Row>,
    unclaimed: Vec<Unclaimed>,
    next_id: u64,
}

impl Queue {
    pub fn new() -> Queue {
        Queue::default()
    }

    fn next(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    pub fn add(&mut self, game: i64, title: &str, now: i64) -> Option<u64> {
        if let Some(position) = self.rows.iter().position(|row| row.game == game) {
            return match self.rows[position].state {
                State::Failed => {
                    let id = self.rows[position].id;
                    self.retry(id, Path::is_file);
                    Some(id)
                }
                State::Done => {
                    self.rows.remove(position);
                    Some(self.push(game, title, now))
                }
                _ => None,
            };
        }
        Some(self.push(game, title, now))
    }

    fn push(&mut self, game: i64, title: &str, added_at: i64) -> u64 {
        let id = self.next();
        self.rows.push(Row {
            id,
            game,
            title: title.to_string(),
            state: State::Waiting,
            reason: None,
            message: None,
            archive: None,
            added_at,
            unpack_done: 0,
            unpack_total: 0,
        });
        id
    }

    fn row_mut(&mut self, id: u64) -> Option<&mut Row> {
        self.rows.iter_mut().find(|row| row.id == id)
    }

    fn forget_unclaimed_without_waiting(&mut self) {
        if !self.rows.iter().any(|row| row.state == State::Waiting) {
            self.unclaimed.clear();
        }
    }

    pub fn waiting(&self) -> Vec<(u64, String)> {
        self.rows
            .iter()
            .filter(|row| row.state == State::Waiting)
            .map(|row| (row.id, row.title.clone()))
            .collect()
    }

    pub fn waiting_since(&self) -> Option<i64> {
        self.rows.iter().filter(|row| row.state == State::Waiting).map(|row| row.added_at).min()
    }

    pub fn knows(&self, path: &Path) -> bool {
        self.rows.iter().any(|row| row.archive.as_deref() == Some(path))
            || self.unclaimed.iter().any(|item| item.path == path)
    }

    pub fn catch(&mut self, id: u64, archive: PathBuf) -> Result<(), QueueError> {
        let row = self.row_mut(id).ok_or(QueueError::Unknown)?;
        if row.state != State::Waiting {
            return Err(QueueError::WrongState);
        }
        row.state = State::Queued;
        row.archive = Some(archive);
        self.forget_unclaimed_without_waiting();
        Ok(())
    }

    pub fn offer(&mut self, path: PathBuf, candidates: Vec<u64>) -> u64 {
        let games = candidates
            .iter()
            .filter_map(|id| self.rows.iter().find(|row| row.id == *id).map(|row| row.game))
            .collect();
        let id = self.next();
        self.unclaimed.push(Unclaimed { id, path, candidates: games });
        id
    }

    pub fn claim(&mut self, unclaimed: u64, row: u64) -> Result<(), QueueError> {
        let position = self.unclaimed.iter().position(|item| item.id == unclaimed).ok_or(QueueError::Unknown)?;
        let path = self.unclaimed[position].path.clone();
        self.catch(row, path)?;
        if let Some(position) = self.unclaimed.iter().position(|item| item.id == unclaimed) {
            self.unclaimed.remove(position);
        }
        Ok(())
    }

    pub fn dismiss_unclaimed(&mut self, unclaimed: u64) -> Option<PathBuf> {
        let position = self.unclaimed.iter().position(|item| item.id == unclaimed)?;
        Some(self.unclaimed.remove(position).path)
    }

    pub fn take_unpack(&mut self) -> Option<Job> {
        if self.rows.iter().any(|row| row.state == State::Unpacking) {
            return None;
        }
        let row = self.rows.iter_mut().find(|row| row.state == State::Queued)?;
        let archive = row.archive.clone()?;
        row.state = State::Unpacking;
        row.unpack_done = 0;
        row.unpack_total = 0;
        Some(Job { id: row.id, game: row.game, archive })
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
        }
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
        if reason == Reason::Missing {
            row.archive = None;
        }
        self.forget_unclaimed_without_waiting();
    }

    pub fn cancel(&mut self, id: u64) -> Option<State> {
        let position = self.rows.iter().position(|row| row.id == id)?;
        let removed = self.rows.remove(position);
        self.forget_unclaimed_without_waiting();
        Some(removed.state)
    }

    pub fn retry(&mut self, id: u64, exists: impl Fn(&Path) -> bool) -> bool {
        let Some(position) = self.rows.iter().position(|row| row.id == id && row.state == State::Failed) else {
            return false;
        };
        let mut row = self.rows.remove(position);
        if !row.archive.as_deref().is_some_and(&exists) {
            row.archive = None;
        }
        row.state = if row.archive.is_some() { State::Queued } else { State::Waiting };
        row.reason = None;
        row.message = None;
        row.unpack_done = 0;
        row.unpack_total = 0;
        self.rows.push(row);
        true
    }

    pub fn dismiss_done(&mut self) {
        self.rows.retain(|row| row.state != State::Done);
    }

    pub fn archive_of(&self, id: u64) -> Option<PathBuf> {
        self.rows.iter().find(|row| row.id == id).and_then(|row| row.archive.clone())
    }

    pub fn saved(&self) -> Vec<Saved> {
        self.rows
            .iter()
            .filter(|row| row.state != State::Done)
            .map(|row| Saved {
                game: row.game,
                failed: row.state == State::Failed,
                reason: if row.state == State::Failed { row.reason } else { None },
                archive: row.archive.as_ref().map(|path| path.to_string_lossy().to_string()),
                added_at: row.added_at,
            })
            .collect()
    }

    pub fn restore(&mut self, saved: Vec<Saved>, mut title_of: impl FnMut(i64) -> Option<String>) {
        for item in saved {
            if self.rows.iter().any(|row| row.game == item.game) {
                continue;
            }
            let Some(title) = title_of(item.game) else { continue };
            let id = self.push(item.game, &title, item.added_at);
            if let Some(row) = self.row_mut(id) {
                row.archive = item.archive.map(PathBuf::from);
                if row.archive.is_some() {
                    row.state = State::Queued;
                }
            }
            if item.failed {
                self.fail(id, item.reason.unwrap_or(Reason::Other));
            }
        }
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
                archive_name: row.archive.as_deref().map(file_name),
                unpack_done: row.unpack_done,
                unpack_total: row.unpack_total,
            })
            .collect();
        let waiting: Vec<&Row> = self.rows.iter().filter(|row| row.state == State::Waiting).collect();
        let unclaimed = self
            .unclaimed
            .iter()
            .map(|item| {
                let (mut options, rest): (Vec<&&Row>, Vec<&&Row>) =
                    waiting.iter().partition(|row| item.candidates.contains(&row.game));
                options.extend(rest);
                UnclaimedView {
                    id: item.id,
                    name: file_name(&item.path),
                    options: options.into_iter().map(|row| row.id).collect(),
                }
            })
            .collect();
        Snapshot { rows, unclaimed }
    }
}

pub fn save_queue(conn: &rusqlite::Connection, items: &[Saved]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM download_queue", [])?;
    {
        let mut insert = tx.prepare(
            "INSERT OR REPLACE INTO download_queue (game_id, pos, state, reason, archive, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for (pos, item) in items.iter().enumerate() {
            let state = match (item.failed, item.archive.is_some()) {
                (true, _) => "failed",
                (false, true) => "queued",
                (false, false) => "waiting",
            };
            insert.execute(rusqlite::params![
                item.game,
                pos as i64,
                state,
                item.reason.map(Reason::code),
                item.archive.as_deref(),
                item.added_at,
            ])?;
        }
    }
    tx.commit()
}

pub fn load_queue(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<Saved>> {
    let mut statement =
        conn.prepare("SELECT game_id, state, reason, archive, added_at FROM download_queue ORDER BY pos")?;
    let rows = statement.query_map([], |row| {
        let reason: Option<String> = row.get(2)?;
        Ok(Saved {
            game: row.get(0)?,
            failed: row.get::<_, String>(1)? == "failed",
            reason: reason.as_deref().and_then(Reason::from_code),
            archive: row.get(3)?,
            added_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue_with(titles: &[&str]) -> Queue {
        let mut queue = Queue::new();
        for (index, title) in titles.iter().enumerate() {
            queue.add(index as i64 + 1, title, 100 + index as i64).unwrap();
        }
        queue
    }

    fn state_of(queue: &Queue, id: u64) -> State {
        queue.snapshot().rows.iter().find(|row| row.id == id).unwrap().state
    }

    fn archive(name: &str) -> PathBuf {
        PathBuf::from(format!(r"C:\Users\me\Downloads\{name}"))
    }

    #[test]
    fn added_games_wait_for_a_file() {
        let queue = queue_with(&["Первая", "Вторая"]);
        let snapshot = queue.snapshot();
        assert!(snapshot.rows.iter().all(|row| row.state == State::Waiting));
        assert_eq!(queue.waiting_since(), Some(100));
        assert_eq!(queue.waiting().len(), 2);
    }

    #[test]
    fn open_game_is_not_added_twice() {
        let mut queue = queue_with(&["Первая"]);
        assert_eq!(queue.add(1, "Первая", 200), None);
        assert_eq!(queue.snapshot().rows.len(), 1);
    }

    #[test]
    fn caught_archives_unpack_one_at_a_time() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.catch(1, archive("a.zip")).unwrap();
        queue.catch(2, archive("b.zip")).unwrap();
        let job = queue.take_unpack().unwrap();
        assert_eq!((job.id, job.game, job.archive), (1, 1, archive("a.zip")));
        assert_eq!(queue.take_unpack(), None);
        assert_eq!(state_of(&queue, 2), State::Queued);
        queue.finish(1);
        assert_eq!(state_of(&queue, 1), State::Done);
        assert_eq!(queue.take_unpack().unwrap().id, 2);
    }

    #[test]
    fn catch_only_takes_waiting_rows() {
        let mut queue = queue_with(&["Первая"]);
        queue.catch(1, archive("a.zip")).unwrap();
        assert_eq!(queue.catch(1, archive("b.zip")), Err(QueueError::WrongState));
        assert_eq!(queue.catch(9, archive("b.zip")), Err(QueueError::Unknown));
        assert!(queue.knows(&archive("a.zip")));
        assert!(!queue.knows(&archive("b.zip")));
    }

    #[test]
    fn unclaimed_archive_lists_candidates_first_then_other_waiting_games() {
        let mut queue = queue_with(&["Lust Academy", "Другая", "Lust Academy 2"]);
        let offer = queue.offer(archive("LustAcademy-1.2.zip"), vec![1, 3]);
        let view = &queue.snapshot().unclaimed[0];
        assert_eq!((view.id, view.name.as_str()), (offer, "LustAcademy-1.2.zip"));
        assert_eq!(view.options, vec![1, 3, 2]);
        assert!(queue.knows(&archive("LustAcademy-1.2.zip")));
    }

    #[test]
    fn claim_gives_the_archive_to_the_chosen_game() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        let offer = queue.offer(archive("x.zip"), vec![]);
        queue.claim(offer, 2).unwrap();
        assert!(queue.snapshot().unclaimed.is_empty());
        assert_eq!(state_of(&queue, 2), State::Queued);
        assert_eq!(queue.archive_of(2), Some(archive("x.zip")));
        assert_eq!(queue.claim(offer, 1), Err(QueueError::Unknown));
    }

    #[test]
    fn dismissed_offer_returns_its_path() {
        let mut queue = queue_with(&["Первая"]);
        let offer = queue.offer(archive("x.zip"), vec![]);
        assert_eq!(queue.dismiss_unclaimed(offer), Some(archive("x.zip")));
        assert!(queue.snapshot().unclaimed.is_empty());
        assert_eq!(queue.dismiss_unclaimed(offer), None);
    }

    #[test]
    fn offers_vanish_when_nobody_waits() {
        let mut queue = queue_with(&["Первая"]);
        queue.offer(archive("x.zip"), vec![]);
        queue.cancel(1);
        assert!(queue.snapshot().unclaimed.is_empty());
    }

    #[test]
    fn retry_requeues_an_existing_archive_and_waits_without_one() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.catch(1, archive("a.zip")).unwrap();
        queue.take_unpack().unwrap();
        queue.fail(1, Reason::Unpack);
        assert!(queue.retry(1, |_| true));
        assert_eq!(state_of(&queue, 1), State::Queued);
        assert_eq!(queue.snapshot().rows.last().unwrap().id, 1);

        queue.take_unpack().unwrap();
        queue.fail(1, Reason::Unpack);
        assert!(queue.retry(1, |_| false));
        assert_eq!(state_of(&queue, 1), State::Waiting);
        assert_eq!(queue.archive_of(1), None);
        assert!(!queue.retry(2, |_| true));
    }

    #[test]
    fn missing_archive_is_forgotten() {
        let mut queue = queue_with(&["Первая"]);
        queue.catch(1, archive("a.zip")).unwrap();
        queue.take_unpack().unwrap();
        queue.fail(1, Reason::Missing);
        assert_eq!(queue.archive_of(1), None);
        let row = &queue.snapshot().rows[0];
        assert_eq!(row.message.as_deref(), Some(Reason::Missing.message()));
    }

    #[test]
    fn add_of_failed_game_retries_it() {
        let mut queue = queue_with(&["Первая"]);
        queue.catch(1, archive("a.zip")).unwrap();
        queue.take_unpack().unwrap();
        queue.fail(1, Reason::Other);
        assert_eq!(queue.add(1, "Первая", 300), Some(1));
        assert_eq!(state_of(&queue, 1), State::Waiting);
    }

    #[test]
    fn unpack_progress_only_while_unpacking() {
        let mut queue = queue_with(&["Первая"]);
        assert!(!queue.unpack_progress(1, 1, 2));
        queue.catch(1, archive("a.zip")).unwrap();
        queue.take_unpack().unwrap();
        assert!(queue.unpack_progress(1, 1, 2));
        let row = &queue.snapshot().rows[0];
        assert_eq!((row.unpack_done, row.unpack_total), (1, 2));
        assert_eq!(row.archive_name.as_deref(), Some("a.zip"));
    }

    #[test]
    fn done_rows_are_dismissed_and_not_saved() {
        let mut queue = queue_with(&["Первая", "Вторая"]);
        queue.catch(1, archive("a.zip")).unwrap();
        queue.take_unpack().unwrap();
        queue.finish(1);
        assert_eq!(queue.saved().len(), 1);
        queue.dismiss_done();
        assert_eq!(queue.snapshot().rows.len(), 1);
    }

    #[test]
    fn saved_queue_round_trips_through_the_database() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let mut queue = queue_with(&["Первая", "Вторая", "Третья"]);
        queue.catch(2, archive("b.zip")).unwrap();
        queue.catch(3, archive("c.zip")).unwrap();
        queue.take_unpack().unwrap();
        queue.fail(2, Reason::NoSpace);
        save_queue(&conn, &queue.saved()).unwrap();

        let loaded = load_queue(&conn).unwrap();
        assert_eq!(loaded.len(), 3);
        let mut restored = Queue::new();
        restored.restore(loaded, |game| Some(format!("Игра {game}")));
        let snapshot = restored.snapshot();
        assert_eq!(snapshot.rows[0].state, State::Waiting);
        assert_eq!((snapshot.rows[1].state, snapshot.rows[1].reason), (State::Failed, Some(Reason::NoSpace)));
        assert_eq!(snapshot.rows[2].state, State::Queued);
        assert_eq!(snapshot.rows[2].archive_name.as_deref(), Some("c.zip"));
        assert_eq!(restored.waiting_since(), Some(100));
    }

    #[test]
    fn restore_skips_games_that_are_gone() {
        let mut queue = Queue::new();
        let saved = vec![
            Saved { game: 1, failed: false, reason: None, archive: None, added_at: 5 },
            Saved { game: 2, failed: false, reason: None, archive: None, added_at: 6 },
        ];
        queue.restore(saved, |game| (game == 2).then(|| "Вторая".to_string()));
        assert_eq!(queue.snapshot().rows.len(), 1);
    }
}
