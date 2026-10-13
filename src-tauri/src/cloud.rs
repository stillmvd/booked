use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use booked_core::cloud::{self, GamesPage, PushReply};
use booked_core::settings;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::db::{with_conn, with_conn_mut, Db};
use crate::games::GAMES_CHANGED_EVENT;

pub const CLOUD_STATUS_EVENT: &str = "cloud:status";

const KEY_SERVICE: &str = "Booked cloud";
const KEY_USER: &str = "api";
const TICK: Duration = Duration::from_secs(5);
const PULL_EVERY: Duration = Duration::from_secs(50);
const OFFLINE_PAUSE: Duration = Duration::from_secs(60);
const BAD_KEY_PAUSE: Duration = Duration::from_secs(600);
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CloudState {
    Off,
    Ok,
    BadKey,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub url: String,
    pub key_tail: Option<String>,
    pub state: CloudState,
    pub pending: i64,
    pub last_sync: Option<i64>,
}

enum Fail {
    Off,
    BadKey,
    Offline,
    Limited(Duration),
    Local(String),
}

#[derive(Default)]
pub struct Cloud {
    key: Mutex<Option<Option<String>>>,
    state: Mutex<Option<CloudState>>,
    last_sync: Mutex<Option<i64>>,
    wake: Notify,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn key_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEY_SERVICE, KEY_USER).ok()
}

impl Cloud {
    fn key(&self) -> Option<String> {
        let mut cached = lock(&self.key);
        if cached.is_none() {
            match key_entry()?.get_password() {
                Ok(key) => *cached = Some(Some(key).filter(|key| !key.trim().is_empty())),
                Err(keyring::Error::NoEntry) => *cached = Some(None),
                Err(_) => return None,
            }
        }
        cached.clone().flatten()
    }

    fn store_key(&self, key: &str) -> Result<(), String> {
        let entry = key_entry().ok_or_else(|| KEY_STORE_ERROR.to_string())?;
        if key.is_empty() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => return Err(KEY_STORE_ERROR.to_string()),
            }
            *lock(&self.key) = Some(None);
        } else {
            entry.set_password(key).map_err(|_| KEY_STORE_ERROR.to_string())?;
            *lock(&self.key) = Some(Some(key.to_string()));
        }
        Ok(())
    }
}

const KEY_STORE_ERROR: &str = "Не удалось сохранить ключ в Диспетчере учётных данных Windows.";

fn base_url(db: &Db) -> Result<String, String> {
    let stored = with_conn(db, |conn| settings::value(conn, cloud::URL_KEY))?;
    Ok(stored
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| cloud::DEFAULT_URL.to_string())
        .trim_end_matches('/')
        .to_string())
}

fn key_tail(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    let shown = (chars.len() / 3).min(4);
    chars[chars.len() - shown..].iter().collect()
}

fn status_now(app: &AppHandle) -> Result<CloudStatus, String> {
    let state = app.state::<Cloud>();
    let db = app.state::<Db>();
    let key = state.key();
    let current = *lock(&state.state);
    let last_sync = *lock(&state.last_sync);
    Ok(CloudStatus {
        url: base_url(&db)?,
        key_tail: key.as_deref().map(key_tail),
        state: if key.is_none() { CloudState::Off } else { current.unwrap_or(CloudState::Ok) },
        pending: with_conn(&db, cloud::outbox_count)?,
        last_sync,
    })
}

fn classify(response: &reqwest::Response) -> Option<Fail> {
    let status = response.status();
    if status.is_success() {
        return None;
    }
    Some(match status.as_u16() {
        404 => Fail::BadKey,
        429 => {
            let secs = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse().ok())
                .unwrap_or(60);
            Fail::Limited(Duration::from_secs(secs))
        }
        _ => Fail::Offline,
    })
}

async fn send(request: reqwest::RequestBuilder) -> Result<Vec<u8>, Fail> {
    let response = request.send().await.map_err(|_| Fail::Offline)?;
    if let Some(fail) = classify(&response) {
        return Err(fail);
    }
    response.bytes().await.map(|b| b.to_vec()).map_err(|_| Fail::Offline)
}

async fn push(app: &AppHandle, client: &reqwest::Client, url: &str, key: &str) -> Result<bool, Fail> {
    let items = {
        let db = app.state::<Db>();
        with_conn(&db, cloud::pending).map_err(Fail::Local)?
    };
    if items.is_empty() {
        return Ok(false);
    }
    for batch in cloud::batches(&items) {
        let wire = cloud::wire_of(batch);
        if !wire.is_empty() {
            let body = serde_json::to_vec(&serde_json::json!({ "changes": wire })).map_err(|e| Fail::Local(e.to_string()))?;
            let bytes = send(
                client
                    .post(format!("{url}/v1/changes"))
                    .bearer_auth(key)
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body(body),
            )
            .await?;
            let reply: PushReply = serde_json::from_slice(&bytes).map_err(|_| Fail::Offline)?;
            for rejected in &reply.rejected {
                if let Some(change) = wire.get(rejected.i) {
                    eprintln!("cloud rejected {} of {}: {}", change.field, change.id, rejected.reason);
                }
            }
            let done = cloud::settled(batch, &reply);
            let db = app.state::<Db>();
            with_conn_mut(&db, |conn| cloud::mark_sent(conn, &done)).map_err(Fail::Local)?;
        } else {
            let db = app.state::<Db>();
            with_conn_mut(&db, |conn| cloud::mark_sent(conn, &batch.iter().collect::<Vec<_>>())).map_err(Fail::Local)?;
        }
    }
    Ok(true)
}

async fn pull(app: &AppHandle, client: &reqwest::Client, url: &str, key: &str) -> Result<(), Fail> {
    let db = app.state::<Db>();
    let read_cursor = || -> Result<i64, Fail> {
        Ok(with_conn(&db, |conn| settings::value(conn, cloud::CURSOR_KEY))
            .map_err(Fail::Local)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    };
    let save_cursor = |cursor: i64| -> Result<(), Fail> {
        with_conn(&db, |conn| settings::write(conn, cloud::CURSOR_KEY, &cursor.to_string())).map_err(Fail::Local)
    };
    let mut cursor = read_cursor()?;
    let mut full: Option<HashSet<i64>> = (cursor == 0).then(HashSet::new);
    let mut changed = false;
    loop {
        let bytes = send(client.get(format!("{url}/v1/games?since={cursor}&limit=500")).bearer_auth(key)).await?;
        let page: GamesPage = serde_json::from_slice(&bytes).map_err(|_| Fail::Offline)?;
        if page.reset {
            cursor = 0;
            full = Some(HashSet::new());
            continue;
        }
        changed |= with_conn_mut(&db, |conn| cloud::apply_incoming(conn, &page.games)).map_err(Fail::Local)?;
        cursor = page.next.max(cursor);
        match full.as_mut() {
            Some(ids) => ids.extend(page.games.iter().map(|game| game.id)),
            None => save_cursor(cursor)?,
        }
        if !page.more {
            break;
        }
    }
    if let Some(ids) = full {
        with_conn_mut(&db, |conn| cloud::requeue_missing(conn, &ids)).map_err(Fail::Local)?;
        save_cursor(cursor)?;
    }
    if changed {
        let _ = app.emit(GAMES_CHANGED_EVENT, ());
    }
    Ok(())
}

async fn tick(app: &AppHandle, client: &reqwest::Client, pull_due: bool) -> Result<bool, Fail> {
    let key = app.state::<Cloud>().key().ok_or(Fail::Off)?;
    let url = base_url(&app.state::<Db>()).map_err(Fail::Local)?;
    let pushed = push(app, client, &url, &key).await?;
    if pushed || pull_due {
        pull(app, client, &url, &key).await?;
        return Ok(true);
    }
    Ok(false)
}

fn set_state(app: &AppHandle, state: Option<CloudState>) {
    *lock(&app.state::<Cloud>().state) = state;
}

async fn run(app: AppHandle) {
    let Ok(client) = reqwest::Client::builder().timeout(HTTP_TIMEOUT).build() else {
        return;
    };
    let mut last_pull: Option<Instant> = None;
    let mut paused_until: Option<Instant> = None;
    let mut shown: Option<CloudStatus> = None;
    let cloud_state = app.state::<Cloud>();
    loop {
        let woke = tokio::select! {
            _ = tokio::time::sleep(TICK) => false,
            _ = cloud_state.wake.notified() => true,
        };
        if woke {
            last_pull = None;
            paused_until = None;
        }
        if paused_until.is_none_or(|until| Instant::now() >= until) {
            let pull_due = last_pull.is_none_or(|at| at.elapsed() >= PULL_EVERY);
            match tick(&app, &client, pull_due).await {
                Ok(pulled) => {
                    set_state(&app, Some(CloudState::Ok));
                    if pulled {
                        last_pull = Some(Instant::now());
                        *lock(&app.state::<Cloud>().last_sync) = Some(cloud::now_ms());
                    }
                    paused_until = None;
                }
                Err(Fail::Off) => set_state(&app, None),
                Err(Fail::BadKey) => {
                    set_state(&app, Some(CloudState::BadKey));
                    paused_until = Some(Instant::now() + BAD_KEY_PAUSE);
                }
                Err(Fail::Offline) => {
                    set_state(&app, Some(CloudState::Offline));
                    paused_until = Some(Instant::now() + OFFLINE_PAUSE);
                }
                Err(Fail::Limited(wait)) => paused_until = Some(Instant::now() + wait),
                Err(Fail::Local(err)) => {
                    eprintln!("cloud sync: {err}");
                    paused_until = Some(Instant::now() + OFFLINE_PAUSE);
                }
            }
        }
        if let Ok(status) = status_now(&app) {
            if shown.as_ref() != Some(&status) {
                let _ = app.emit(CLOUD_STATUS_EVENT, &status);
                shown = Some(status);
            }
        }
    }
}

pub fn setup(app: &AppHandle) {
    app.manage(Cloud::default());
    let handle = app.clone();
    tauri::async_runtime::spawn(run(handle));
}

#[tauri::command]
pub fn cloud_status(app: AppHandle) -> Result<CloudStatus, String> {
    status_now(&app)
}

fn clean_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let parsed = url::Url::parse(trimmed).map_err(|_| "Адрес облака не похож на ссылку.".to_string())?;
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if parsed.scheme() != "https" && !(local && parsed.scheme() == "http") {
        return Err("Адрес облака должен начинаться с https://".to_string());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn cloud_set(app: AppHandle, url: String, key: Option<String>) -> Result<CloudStatus, String> {
    let url = clean_url(&url)?;
    {
        let db = app.state::<Db>();
        let before = base_url(&db)?;
        with_conn(&db, |conn| settings::write(conn, cloud::URL_KEY, &url))?;
        if before != url {
            with_conn(&db, |conn| settings::write(conn, cloud::CURSOR_KEY, "0"))?;
            with_conn_mut(&db, |conn| cloud::requeue_missing(conn, &HashSet::new()))?;
        }
    }
    let cloud_state = app.state::<Cloud>();
    if let Some(key) = key {
        cloud_state.store_key(key.trim())?;
    }

    let state = match cloud_state.key() {
        None => None,
        Some(key) => {
            let client = reqwest::Client::builder()
                .timeout(HTTP_TIMEOUT)
                .build()
                .map_err(|_| "Не удалось подготовить соединение.".to_string())?;
            Some(match send(client.get(format!("{url}/v1/health")).bearer_auth(&key)).await {
                Ok(_) => CloudState::Ok,
                Err(Fail::BadKey) => CloudState::BadKey,
                Err(_) => CloudState::Offline,
            })
        }
    };
    set_state(&app, state);
    cloud_state.wake.notify_one();
    let status = status_now(&app)?;
    let _ = app.emit(CLOUD_STATUS_EVENT, &status);
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_tail_never_reveals_a_short_key() {
        assert_eq!(key_tail("abcdef123456"), "3456");
        assert_eq!(key_tail("ab"), "");
        assert_eq!(key_tail("dev"), "v");
        assert_eq!(key_tail("ключик"), "ик");
    }

    #[test]
    fn url_must_be_https_except_loopback() {
        assert_eq!(clean_url(" https://x.workers.dev/ ").unwrap(), "https://x.workers.dev");
        assert!(clean_url("ftp://x").is_err());
        assert!(clean_url("nonsense").is_err());
        assert!(clean_url("http://example.com").is_err(), "the key never travels over plain http");
        assert_eq!(clean_url("http://127.0.0.1:8787").unwrap(), "http://127.0.0.1:8787");
    }
}
