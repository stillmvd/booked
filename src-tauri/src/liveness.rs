use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use trove_core::liveness::{self, Probe, Written};
use trove_core::settings;

use crate::db::{with_conn, with_conn_mut, Db};
use crate::net::{self, Fetcher};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivenessItem {
    pub id: i64,
    pub link_status: String,
    pub link_reason: Option<String>,
    pub http_status: Option<u16>,
    pub last_checked_at: Option<i64>,
    pub fail_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivenessSweep {
    pub items: Vec<LivenessItem>,
    pub discarded: bool,
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn select_due(conn: &Connection, ids: &[i64], force: bool) -> rusqlite::Result<Vec<(i64, String)>> {
    if !liveness::is_enabled(conn) {
        return Ok(Vec::new());
    }
    let period = settings::read(conn)?.liveness_period;
    let Some(stale_secs) = settings::stale_secs(period) else {
        return Ok(Vec::new());
    };
    liveness::due_for_check(conn, ids, force, stale_secs)
}

fn apply_sweep(
    conn: &mut Connection,
    probes: &[(i64, Option<Probe>)],
    discard_guard: bool,
) -> rusqlite::Result<LivenessSweep> {
    let now = now_unix();
    let mut rows: Vec<(i64, Written)> = Vec::new();
    let mut total_checks = 0usize;
    let mut network_failures = 0usize;

    for (id, probe) in probes {
        let probe = match probe {
            Some(probe) => probe,
            None => continue,
        };
        total_checks += 1;
        if probe.http_status.is_none() {
            network_failures += 1;
        }
        let prev = liveness::previous_for(conn, *id);
        if let Some(written) = liveness::verdict(&prev, probe, now) {
            rows.push((*id, written));
        }
    }

    if discard_guard && total_checks >= liveness::DISCARD_MIN_CHECKS && network_failures * 2 > total_checks {
        return Ok(LivenessSweep { items: Vec::new(), discarded: true });
    }

    liveness::record_batch(conn, &rows)?;

    let items = rows
        .into_iter()
        .map(|(id, written)| LivenessItem {
            id,
            link_status: written.status.as_str().to_string(),
            link_reason: written.reason.map(|reason| reason.as_str().to_string()),
            http_status: written.http_status,
            last_checked_at: Some(now),
            fail_count: written.fail_count,
        })
        .collect();

    Ok(LivenessSweep { items, discarded: false })
}

async fn collect_probes(app: &AppHandle, due: Vec<(i64, String)>) -> Vec<(i64, Option<Probe>)> {
    let mut handles = Vec::with_capacity(due.len());
    for (id, url) in due {
        let app = app.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            let fetcher = app.state::<Fetcher>();
            if fetcher.is_cancelled() {
                return (id, None);
            }
            let probe = net::probe_liveness(&fetcher, &url).await;
            (id, probe)
        }));
    }

    let mut probes = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(result) = handle.await {
            probes.push(result);
        }
    }
    probes
}

async fn run_sweep(
    app: &AppHandle,
    db: &State<'_, Db>,
    ids: Vec<i64>,
    force: bool,
    discard_guard: bool,
) -> Result<LivenessSweep, String> {
    let due = with_conn(db, |conn| select_due(conn, &ids, force))?;
    if due.is_empty() {
        return Ok(LivenessSweep { items: Vec::new(), discarded: false });
    }

    let probes = collect_probes(app, due).await;
    with_conn_mut(db, |conn| apply_sweep(conn, &probes, discard_guard))
}

#[tauri::command]
pub async fn liveness_sweep(
    app: AppHandle,
    db: State<'_, Db>,
    ids: Vec<i64>,
    force: bool,
) -> Result<LivenessSweep, String> {
    run_sweep(&app, &db, ids, force, true).await
}

#[tauri::command]
pub async fn liveness_check(app: AppHandle, db: State<'_, Db>, id: i64) -> Result<LivenessItem, String> {
    let sweep = run_sweep(&app, &db, vec![id], true, false).await?;
    sweep
        .items
        .into_iter()
        .next()
        .ok_or_else(|| "проверка не выполнена: строка не найдена".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use trove_core::db::migrate;
    use trove_core::liveness::NetKind;
    use trove_core::url_norm;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn insert_bookmark(conn: &Connection, url: &str) -> i64 {
        let parsed = url_norm::parse(url).unwrap();
        conn.execute(
            "INSERT INTO bookmarks (folder_id, title, url, url_normalized) VALUES (NULL, ?1, ?2, ?3)",
            params!["T", parsed.url, parsed.normalized],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn checked_at(conn: &Connection, id: i64) -> Option<i64> {
        conn.query_row("SELECT last_checked_at FROM bookmarks WHERE id = ?1", params![id], |row| row.get(0))
            .unwrap()
    }

    fn ok_probe() -> Option<Probe> {
        Some(Probe { http_status: Some(200), cf_challenge: false, net: None })
    }

    fn network_fail_probe() -> Option<Probe> {
        Some(Probe { http_status: None, cf_challenge: false, net: Some(NetKind::Timeout) })
    }

    #[test]
    fn discard_guard_drops_the_whole_pass_when_more_than_half_fail_at_network_level() {
        let mut conn = test_conn();
        let ids: Vec<i64> =
            (0..6).map(|i| insert_bookmark(&conn, &format!("https://example.test/discard-{i}"))).collect();
        let probes: Vec<(i64, Option<Probe>)> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| (*id, if i < 4 { network_fail_probe() } else { ok_probe() }))
            .collect();

        let result = apply_sweep(&mut conn, &probes, true).unwrap();
        assert!(result.discarded);
        assert!(result.items.is_empty());

        for id in ids {
            assert_eq!(checked_at(&conn, id), None);
        }
    }

    #[test]
    fn below_threshold_pass_writes_even_when_every_check_fails() {
        let mut conn = test_conn();
        let a = insert_bookmark(&conn, "https://example.test/below-a");
        let b = insert_bookmark(&conn, "https://example.test/below-b");
        let probes = vec![(a, network_fail_probe()), (b, network_fail_probe())];

        let result = apply_sweep(&mut conn, &probes, true).unwrap();
        assert!(!result.discarded);
        assert_eq!(result.items.len(), 2);

        assert!(checked_at(&conn, a).is_some());
        assert!(checked_at(&conn, b).is_some());
    }

    #[test]
    fn manual_check_writes_even_when_it_would_otherwise_be_discarded() {
        let mut conn = test_conn();
        let id = insert_bookmark(&conn, "https://example.test/manual");
        let probes = vec![(id, network_fail_probe())];

        let result = apply_sweep(&mut conn, &probes, false).unwrap();
        assert!(!result.discarded);
        assert_eq!(result.items.len(), 1);
        assert!(checked_at(&conn, id).is_some());
    }

    #[test]
    fn cancelled_rows_contribute_no_check_and_are_left_untouched() {
        let mut conn = test_conn();
        let id = insert_bookmark(&conn, "https://example.test/cancelled");
        let probes = vec![(id, None)];

        let result = apply_sweep(&mut conn, &probes, true).unwrap();
        assert!(result.items.is_empty());
        assert!(!result.discarded);
        assert_eq!(checked_at(&conn, id), None);
    }

    #[test]
    fn select_due_returns_empty_and_skips_the_query_when_liveness_is_disabled() {
        let conn = test_conn();
        let id = insert_bookmark(&conn, "https://example.test/disabled");
        conn.execute("INSERT INTO settings (key, value) VALUES ('liveness_enabled', '0')", []).unwrap();

        let due = select_due(&conn, &[id], false).unwrap();
        assert!(due.is_empty());
    }

    #[test]
    fn select_due_returns_empty_without_any_probe_when_period_is_never() {
        let conn = test_conn();
        let id = insert_bookmark(&conn, "https://example.test/never");
        settings::write(&conn, "liveness_period", "never").unwrap();

        let due = select_due(&conn, &[id], false).unwrap();
        assert!(due.is_empty());
    }

    #[test]
    fn select_due_uses_day_period_stale_threshold() {
        let conn = test_conn();
        let id = insert_bookmark(&conn, "https://example.test/day-period");
        conn.execute(
            "UPDATE bookmarks SET link_status = 'ok', http_status = 200, \
             last_checked_at = unixepoch() - ?1 WHERE id = ?2",
            params![2 * 86_400i64, id],
        )
        .unwrap();
        settings::write(&conn, "liveness_period", "day").unwrap();

        let due = select_due(&conn, &[id], false).unwrap();
        assert_eq!(due.len(), 1);
    }

    #[test]
    fn select_due_runs_normally_when_liveness_is_enabled() {
        let conn = test_conn();
        let id = insert_bookmark(&conn, "https://example.test/enabled");

        let due = select_due(&conn, &[id], false).unwrap();
        assert_eq!(due.len(), 1);
    }
}
