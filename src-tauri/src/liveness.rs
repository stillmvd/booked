use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use booked_core::liveness::{self, DueLink, Probe, Written};
use booked_core::settings;

use crate::db::{with_conn, with_conn_mut, Db};
use crate::net::{self, Fetcher};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkLivenessItem {
    pub id: i64,
    pub link_status: Option<String>,
    pub link_reason: Option<String>,
    pub http_status: Option<i64>,
    pub last_checked_at: Option<i64>,
    pub fail_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivenessItem {
    pub id: i64,
    pub link_status: Option<String>,
    pub link_reason: Option<String>,
    pub http_status: Option<i64>,
    pub last_checked_at: Option<i64>,
    pub fail_count: i64,
    pub links: Vec<LinkLivenessItem>,
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

fn select_due(conn: &Connection, ids: &[i64], force: bool) -> rusqlite::Result<Vec<DueLink>> {
    if !liveness::is_enabled(conn) {
        return Ok(Vec::new());
    }
    let period = settings::read(conn)?.liveness_period;
    let Some(stale_secs) = settings::stale_secs(period) else {
        return Ok(Vec::new());
    };
    liveness::due_for_check(conn, ids, force, stale_secs)
}

fn item_for(conn: &Connection, bookmark_id: i64) -> rusqlite::Result<LivenessItem> {
    let links = booked_core::links::list(conn, bookmark_id)?
        .into_iter()
        .map(|link| LinkLivenessItem {
            id: link.id,
            link_status: link.link_status,
            link_reason: link.link_reason,
            http_status: link.http_status,
            last_checked_at: link.last_checked_at,
            fail_count: link.fail_count,
        })
        .collect();
    conn.query_row(
        "SELECT link_status, link_reason, http_status, last_checked_at, fail_count FROM bookmarks WHERE id = ?1",
        params![bookmark_id],
        |row| {
            Ok(LivenessItem {
                id: bookmark_id,
                link_status: row.get(0)?,
                link_reason: row.get(1)?,
                http_status: row.get(2)?,
                last_checked_at: row.get(3)?,
                fail_count: row.get(4)?,
                links,
            })
        },
    )
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

    for (link_id, probe) in probes {
        let probe = match probe {
            Some(probe) => probe,
            None => continue,
        };
        total_checks += 1;
        if probe.http_status.is_none() {
            network_failures += 1;
        }
        let prev = liveness::previous_for(conn, *link_id);
        if let Some(written) = liveness::verdict(&prev, probe, now) {
            rows.push((*link_id, written));
        }
    }

    if discard_guard && total_checks >= liveness::DISCARD_MIN_CHECKS && network_failures * 2 > total_checks {
        return Ok(LivenessSweep { items: Vec::new(), discarded: true });
    }

    let bookmark_ids = liveness::record_batch(conn, &rows)?;
    let items = bookmark_ids
        .into_iter()
        .map(|bookmark_id| item_for(conn, bookmark_id))
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(LivenessSweep { items, discarded: false })
}

async fn collect_probes(app: &AppHandle, due: Vec<DueLink>) -> Vec<(i64, Option<Probe>)> {
    let mut handles = Vec::with_capacity(due.len());
    for link in due {
        let app = app.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            let fetcher = app.state::<Fetcher>();
            if fetcher.is_cancelled() {
                return (link.link_id, None);
            }
            let probe = net::probe_liveness(&fetcher, &link.url).await;
            (link.link_id, probe)
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
        .find(|item| item.id == id)
        .ok_or_else(|| "проверка не выполнена: строка не найдена".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use booked_core::db::migrate;
    use booked_core::liveness::NetKind;
    use booked_core::url_norm;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn insert_bookmark(conn: &Connection, url: &str) -> i64 {
        let parsed = url_norm::parse(url).unwrap();
        booked_core::bookmarks::create(conn, None, "T", &parsed, None, None).unwrap()
    }

    fn link_of(conn: &Connection, bookmark_id: i64) -> i64 {
        booked_core::links::list(conn, bookmark_id).unwrap()[0].id
    }

    fn checked_at(conn: &Connection, bookmark_id: i64) -> Option<i64> {
        booked_core::links::list(conn, bookmark_id).unwrap()[0].last_checked_at
    }

    fn ok_probe() -> Option<Probe> {
        Some(Probe { http_status: Some(200), cf_challenge: false, net: None })
    }

    fn not_found_probe() -> Option<Probe> {
        Some(Probe { http_status: Some(404), cf_challenge: false, net: None })
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
            .map(|(i, id)| (link_of(&conn, *id), if i < 4 { network_fail_probe() } else { ok_probe() }))
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
        let probes = vec![(link_of(&conn, a), network_fail_probe()), (link_of(&conn, b), network_fail_probe())];

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
        let probes = vec![(link_of(&conn, id), network_fail_probe())];

        let result = apply_sweep(&mut conn, &probes, false).unwrap();
        assert!(!result.discarded);
        assert_eq!(result.items.len(), 1);
        assert!(checked_at(&conn, id).is_some());
    }

    #[test]
    fn cancelled_rows_contribute_no_check_and_are_left_untouched() {
        let mut conn = test_conn();
        let id = insert_bookmark(&conn, "https://example.test/cancelled");
        let probes = vec![(link_of(&conn, id), None)];

        let result = apply_sweep(&mut conn, &probes, true).unwrap();
        assert!(result.items.is_empty());
        assert!(!result.discarded);
        assert_eq!(checked_at(&conn, id), None);
    }

    #[test]
    fn sweep_item_carries_every_link_status_and_primary_status_for_the_bookmark() {
        let mut conn = test_conn();
        let id = insert_bookmark(&conn, "https://www.instagram.com/anya.draws");
        booked_core::links::replace_all(
            &mut conn,
            id,
            &[
                booked_core::links::LinkInput { url: "https://www.instagram.com/anya.draws".into(), label: None },
                booked_core::links::LinkInput { url: "https://youtube.com/@anyadraws".into(), label: None },
            ],
        )
        .unwrap();
        let links = booked_core::links::list(&conn, id).unwrap();

        let result = apply_sweep(&mut conn, &[(links[0].id, ok_probe()), (links[1].id, not_found_probe())], false).unwrap();

        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.id, id);
        assert_eq!(item.link_status.as_deref(), Some("ok"));
        assert_eq!(item.http_status, Some(200));
        let statuses: Vec<Option<&str>> = item.links.iter().map(|l| l.link_status.as_deref()).collect();
        assert_eq!(statuses, [Some("ok"), Some("error")]);
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
            "UPDATE bookmark_links SET link_status = 'ok', http_status = 200, \
             last_checked_at = unixepoch() - ?1 WHERE bookmark_id = ?2",
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
