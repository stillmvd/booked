use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use trove_core::preview;

use crate::db::{with_conn, with_conn_mut, Db};
use crate::net::{self, FetchCancel, Fetcher};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInfo {
    pub file: Option<String>,
    pub origin: Option<String>,
    pub title: Option<String>,
    pub blocked: bool,
}

async fn fetch_and_link(
    app: &AppHandle,
    db: &State<'_, Db>,
    fetcher: &State<'_, Fetcher>,
    id: i64,
) -> Result<PreviewInfo, String> {
    let (url, url_normalized) = with_conn(db, |conn| {
        conn.query_row(
            "SELECT url, url_normalized FROM bookmarks WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
    })?;

    let local_data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let previews_dir = local_data_dir.join("previews");
    let icons_dir = local_data_dir.join("icons");

    let outcome = net::resolve_preview(fetcher, db, &url, &url_normalized, &previews_dir, &icons_dir)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(file) = &outcome.file {
        let origin = outcome.origin.unwrap_or(preview::PreviewOrigin::Og);
        with_conn(db, |conn| preview::set_auto_preview(conn, id, file, origin))?;
    }

    Ok(PreviewInfo {
        origin: outcome.origin.map(|o| o.as_str().to_string()),
        file: outcome.file,
        title: outcome.title,
        blocked: outcome.blocked,
    })
}

#[tauri::command]
pub async fn preview_fetch(
    app: AppHandle,
    db: State<'_, Db>,
    fetcher: State<'_, Fetcher>,
    id: i64,
) -> Result<PreviewInfo, String> {
    fetch_and_link(&app, &db, &fetcher, id).await
}

#[tauri::command]
pub async fn preview_refresh(
    app: AppHandle,
    db: State<'_, Db>,
    fetcher: State<'_, Fetcher>,
    id: i64,
) -> Result<PreviewInfo, String> {
    fetch_and_link(&app, &db, &fetcher, id).await
}

#[tauri::command]
pub async fn meta_fetch(
    app: AppHandle,
    db: State<'_, Db>,
    fetcher: State<'_, Fetcher>,
    url: String,
) -> Result<PreviewInfo, String> {
    let parsed = trove_core::url_norm::parse(&url).map_err(|e| e.to_string())?;

    let local_data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let previews_dir = local_data_dir.join("previews");
    let icons_dir = local_data_dir.join("icons");

    let outcome = net::resolve_preview(
        &fetcher,
        &db,
        &parsed.url,
        &parsed.normalized,
        &previews_dir,
        &icons_dir,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(PreviewInfo {
        origin: outcome.origin.map(|o| o.as_str().to_string()),
        file: outcome.file,
        title: outcome.title,
        blocked: outcome.blocked,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewBackfillItem {
    pub id: i64,
    pub file: Option<String>,
    pub origin: Option<String>,
}

#[tauri::command]
pub async fn preview_backfill(
    app: AppHandle,
    db: State<'_, Db>,
    ids: Vec<i64>,
    force: bool,
) -> Result<Vec<PreviewBackfillItem>, String> {
    let due = with_conn(&db, |conn| preview::due_for_preview(conn, &ids, force))?;
    if due.is_empty() {
        return Ok(Vec::new());
    }

    let local_data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let previews_dir = local_data_dir.join("previews");
    let icons_dir = local_data_dir.join("icons");

    let mut handles = Vec::with_capacity(due.len());
    for (id, url, url_normalized) in due {
        let app = app.clone();
        let previews_dir = previews_dir.clone();
        let icons_dir = icons_dir.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            let cancelled = app.state::<FetchCancel>().0.load(std::sync::atomic::Ordering::Relaxed);
            if cancelled {
                return (id, None, None);
            }
            let db = app.state::<Db>();
            let fetcher = app.state::<Fetcher>();
            match net::resolve_preview(&fetcher, &db, &url, &url_normalized, &previews_dir, &icons_dir).await {
                Ok(outcome) => (id, outcome.file, outcome.origin),
                Err(_) => (id, None, None),
            }
        }));
    }

    let mut writes = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(result) = handle.await {
            writes.push(result);
        }
    }

    with_conn_mut(&db, |conn| preview::set_auto_preview_batch(conn, &writes))?;

    Ok(writes
        .into_iter()
        .map(|(id, file, origin)| PreviewBackfillItem {
            id,
            file,
            origin: origin.map(|o| o.as_str().to_string()),
        })
        .collect())
}

#[tauri::command]
pub fn preview_backfill_cancel(cancel: State<FetchCancel>) {
    cancel.0.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn test_db() -> Db {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        trove_core::db::migrate(&conn).unwrap();
        Db(Mutex::new(Ok(conn)))
    }

    #[test]
    #[ignore]
    fn resolve_preview_downloads_real_og_image_to_disk() {
        let dir = std::env::temp_dir().join(format!("trove-tracer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let fetcher = Fetcher::new(net::build_client());
        let db = test_db();
        let url = "https://github.com/tauri-apps/tauri";

        let outcome = tauri::async_runtime::block_on(async {
            net::resolve_preview(&fetcher, &db, url, url, &dir, &dir).await
        })
        .expect("resolve_preview failed");

        assert!(!outcome.blocked);
        let filename = outcome.file.expect("no preview file resolved from live page");
        let full = dir.join(&filename[..2]).join(&filename);
        assert!(full.exists(), "preview file missing on disk at {full:?}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[ignore]
    fn resolve_preview_derives_youtube_thumbnail_without_page_fetch() {
        let dir = std::env::temp_dir().join(format!("trove-tracer-yt-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let fetcher = Fetcher::new(net::build_client());
        let db = test_db();
        let url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

        let outcome = tauri::async_runtime::block_on(async {
            net::resolve_preview(&fetcher, &db, url, url, &dir, &dir).await
        })
        .expect("resolve_preview failed");

        assert_eq!(outcome.origin, Some(preview::PreviewOrigin::HostRule));
        assert!(outcome.file.is_some());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[ignore]
    fn resolve_preview_rewrites_reddit_to_old_domain() {
        let dir = std::env::temp_dir().join(format!("trove-tracer-reddit-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let fetcher = Fetcher::new(net::build_client());
        let db = test_db();
        let url = "https://www.reddit.com/r/rust/";

        let outcome = tauri::async_runtime::block_on(async {
            net::resolve_preview(&fetcher, &db, url, url, &dir, &dir).await
        })
        .expect("resolve_preview failed");

        assert!(!outcome.blocked, "www.reddit.com challenge page leaked through without host rewrite");
        assert!(outcome.file.is_some());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[ignore]
    fn resolve_preview_finds_no_image_for_instagram_without_crashing() {
        let dir = std::env::temp_dir().join(format!("trove-tracer-ig-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let fetcher = Fetcher::new(net::build_client());
        let db = test_db();
        let url = "https://www.instagram.com/nasa/";

        let outcome = tauri::async_runtime::block_on(async {
            net::resolve_preview(&fetcher, &db, url, url, &dir, &dir).await
        })
        .expect("resolve_preview failed");

        assert!(outcome.file.is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[ignore]
    fn resolve_preview_returns_graceful_error_when_host_unreachable() {
        let dir = std::env::temp_dir().join(format!("trove-tracer-unreachable-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let fetcher = Fetcher::new(net::build_client());
        let db = test_db();
        let url = "https://this-domain-does-not-exist-trove.invalid/";

        let result = tauri::async_runtime::block_on(async {
            net::resolve_preview(&fetcher, &db, url, url, &dir, &dir).await
        });

        assert!(result.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[tauri::command]
pub fn preview_clear_user_image(db: State<Db>, id: i64) -> Result<(), String> {
    with_conn(&db, |conn| preview::clear_user_image(conn, id))
}
