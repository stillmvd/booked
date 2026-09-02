use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

pub const SWEEP_BATCH: usize = 50;
pub const DISCARD_MIN_CHECKS: usize = 4;
pub const STRIKE_INTERVAL_SECS: i64 = 86400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkStatus {
    Ok,
    Gated,
    Blocked,
    Throttled,
    Error,
    Dead,
}

impl LinkStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkStatus::Ok => "ok",
            LinkStatus::Gated => "gated",
            LinkStatus::Blocked => "blocked",
            LinkStatus::Throttled => "throttled",
            LinkStatus::Error => "error",
            LinkStatus::Dead => "dead",
        }
    }
}

impl std::str::FromStr for LinkStatus {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "ok" => Ok(LinkStatus::Ok),
            "gated" => Ok(LinkStatus::Gated),
            "blocked" => Ok(LinkStatus::Blocked),
            "throttled" => Ok(LinkStatus::Throttled),
            "error" => Ok(LinkStatus::Error),
            "dead" => Ok(LinkStatus::Dead),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetKind {
    Timeout,
    Dns,
    Refused,
    Tls,
    Redirects,
    Other,
}

impl NetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NetKind::Timeout => "timeout",
            NetKind::Dns => "dns",
            NetKind::Refused => "refused",
            NetKind::Tls => "tls",
            NetKind::Redirects => "redirects",
            NetKind::Other => "other",
        }
    }
}

impl std::str::FromStr for NetKind {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "timeout" => Ok(NetKind::Timeout),
            "dns" => Ok(NetKind::Dns),
            "refused" => Ok(NetKind::Refused),
            "tls" => Ok(NetKind::Tls),
            "redirects" => Ok(NetKind::Redirects),
            "other" => Ok(NetKind::Other),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Probe {
    pub http_status: Option<u16>,
    pub cf_challenge: bool,
    pub net: Option<NetKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Written {
    pub status: LinkStatus,
    pub reason: Option<NetKind>,
    pub http_status: Option<u16>,
    pub fail_count: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Previous {
    pub status: Option<LinkStatus>,
    pub http_status: Option<u16>,
    pub last_checked_at: Option<i64>,
    pub fail_count: i64,
}

fn is_strike_code(code: u16) -> bool {
    matches!(code, 404 | 410)
}

pub fn verdict(prev: &Previous, probe: &Probe, now: i64) -> Option<Written> {
    if probe.cf_challenge {
        return Some(Written {
            status: LinkStatus::Blocked,
            reason: None,
            http_status: probe.http_status,
            fail_count: 0,
        });
    }

    let code = match probe.http_status {
        Some(code) => code,
        None => {
            return Some(Written {
                status: LinkStatus::Error,
                reason: probe.net,
                http_status: None,
                fail_count: prev.fail_count + 1,
            });
        }
    };

    if (200..400).contains(&code) {
        return Some(Written { status: LinkStatus::Ok, reason: None, http_status: Some(code), fail_count: 0 });
    }
    if matches!(code, 405 | 501) {
        return Some(Written { status: LinkStatus::Ok, reason: None, http_status: Some(code), fail_count: 0 });
    }
    if matches!(code, 401 | 403 | 451) {
        return Some(Written { status: LinkStatus::Gated, reason: None, http_status: Some(code), fail_count: 0 });
    }
    if is_strike_code(code) {
        let prev_was_strike = prev.http_status.is_some_and(is_strike_code) && prev.fail_count >= 1;
        let interval_elapsed = prev
            .last_checked_at
            .is_some_and(|checked_at| now - checked_at >= STRIKE_INTERVAL_SECS);
        if prev_was_strike && interval_elapsed {
            return Some(Written {
                status: LinkStatus::Dead,
                reason: None,
                http_status: Some(code),
                fail_count: prev.fail_count + 1,
            });
        }
        return Some(Written {
            status: LinkStatus::Error,
            reason: None,
            http_status: Some(code),
            fail_count: prev.fail_count + 1,
        });
    }
    if matches!(code, 429 | 503) {
        return None;
    }

    Some(Written { status: LinkStatus::Error, reason: None, http_status: Some(code), fail_count: prev.fail_count + 1 })
}

pub fn due_for_check(
    conn: &Connection,
    ids: &[i64],
    force: bool,
    stale_secs: i64,
) -> rusqlite::Result<Vec<(i64, String)>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
    let sql = if force {
        format!(
            "SELECT id, url FROM bookmarks WHERE id IN ({}) \
             ORDER BY (last_checked_at IS NOT NULL), last_checked_at LIMIT {SWEEP_BATCH}",
            placeholders.join(",")
        )
    } else {
        format!(
            "SELECT id, url FROM bookmarks WHERE id IN ({}) AND ( \
                 last_checked_at IS NULL \
                 OR (link_status = 'error' AND last_checked_at < unixepoch() - {STRIKE_INTERVAL_SECS}) \
                 OR last_checked_at < unixepoch() - {stale_secs} \
             ) ORDER BY (last_checked_at IS NOT NULL), last_checked_at LIMIT {SWEEP_BATCH}",
            placeholders.join(",")
        )
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids.iter()), |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

pub fn previous_for(conn: &Connection, id: i64) -> Previous {
    conn.query_row(
        "SELECT link_status, http_status, last_checked_at, fail_count FROM bookmarks WHERE id = ?1",
        params![id],
        |row| {
            let status_str: Option<String> = row.get(0)?;
            let status = status_str.and_then(|s| s.parse::<LinkStatus>().ok());
            Ok(Previous {
                status,
                http_status: row.get(1)?,
                last_checked_at: row.get(2)?,
                fail_count: row.get(3)?,
            })
        },
    )
    .optional()
    .unwrap_or(None)
    .unwrap_or(Previous { status: None, http_status: None, last_checked_at: None, fail_count: 0 })
}

pub fn record_batch(conn: &mut Connection, rows: &[(i64, Written)]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for (id, written) in rows {
        tx.execute(
            "UPDATE bookmarks SET link_status = ?1, link_reason = ?2, http_status = ?3, \
             last_checked_at = unixepoch(), fail_count = ?4 WHERE id = ?5",
            params![
                written.status.as_str(),
                written.reason.map(|reason| reason.as_str()),
                written.http_status,
                written.fail_count,
                id,
            ],
        )?;
    }
    tx.commit()
}

pub fn is_enabled(conn: &Connection) -> bool {
    let value: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'liveness_enabled'", [], |row| row.get(0))
        .optional()
        .unwrap_or(None);
    value.as_deref() != Some("0")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::url_norm;

    const STALE_SECS: i64 = 7 * 86400;

    fn setup() -> Connection {
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

    fn set_checked(conn: &Connection, id: i64, status: &str, http_status: Option<i64>, fail_count: i64, secs_ago: i64) {
        conn.execute(
            "UPDATE bookmarks SET link_status = ?1, http_status = ?2, fail_count = ?3, \
             last_checked_at = unixepoch() - ?4 WHERE id = ?5",
            params![status, http_status, fail_count, secs_ago, id],
        )
        .unwrap();
    }

    fn prev(status: Option<LinkStatus>, http_status: Option<u16>, last_checked_at: Option<i64>, fail_count: i64) -> Previous {
        Previous { status, http_status, last_checked_at, fail_count }
    }

    fn probe(http_status: Option<u16>) -> Probe {
        Probe { http_status, cf_challenge: false, net: None }
    }

    #[test]
    fn ok_response_resets_fail_count_even_after_error_streak() {
        let p = prev(Some(LinkStatus::Error), Some(500), Some(0), 3);
        let written = verdict(&p, &probe(Some(200)), 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Ok);
        assert_eq!(written.fail_count, 0);
    }

    #[test]
    fn redirected_response_landing_on_200_gives_ok() {
        let p = prev(None, None, None, 0);
        let written = verdict(&p, &probe(Some(200)), 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Ok);
    }

    #[test]
    fn gated_codes_never_give_dead() {
        let p = prev(None, None, None, 0);
        for code in [401, 403, 451] {
            let written = verdict(&p, &probe(Some(code)), 1_000).unwrap();
            assert_eq!(written.status, LinkStatus::Gated);
        }
    }

    #[test]
    fn challenge_header_on_403_gives_blocked_not_gated() {
        let p = prev(None, None, None, 0);
        let challenged = Probe { http_status: Some(403), cf_challenge: true, net: None };
        let written = verdict(&p, &challenged, 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Blocked);
    }

    #[test]
    fn challenge_header_on_503_gives_blocked_instead_of_no_record() {
        let p = prev(None, None, None, 0);
        let challenged = Probe { http_status: Some(503), cf_challenge: true, net: None };
        let written = verdict(&p, &challenged, 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Blocked);
    }

    #[test]
    fn method_not_allowed_and_not_implemented_give_ok() {
        let p = prev(None, None, None, 0);
        for code in [405, 501] {
            let written = verdict(&p, &probe(Some(code)), 1_000).unwrap();
            assert_eq!(written.status, LinkStatus::Ok);
        }
    }

    #[test]
    fn throttled_codes_without_challenge_are_not_a_check() {
        let p = prev(None, None, None, 0);
        for code in [429, 503] {
            assert!(verdict(&p, &probe(Some(code)), 1_000).is_none());
        }
    }

    #[test]
    fn first_404_gives_error_with_code_and_strike_one() {
        let p = prev(None, None, None, 0);
        let written = verdict(&p, &probe(Some(404)), 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Error);
        assert_eq!(written.http_status, Some(404));
        assert_eq!(written.fail_count, 1);
    }

    #[test]
    fn second_404_after_25_hours_gives_dead() {
        let p = prev(Some(LinkStatus::Error), Some(404), Some(0), 1);
        let written = verdict(&p, &probe(Some(404)), 25 * 3600).unwrap();
        assert_eq!(written.status, LinkStatus::Dead);
        assert_eq!(written.fail_count, 2);
    }

    #[test]
    fn second_404_after_3_hours_stays_error() {
        let p = prev(Some(LinkStatus::Error), Some(404), Some(0), 1);
        let written = verdict(&p, &probe(Some(404)), 3 * 3600).unwrap();
        assert_eq!(written.status, LinkStatus::Error);
    }

    #[test]
    fn two_clicks_a_second_apart_never_give_dead() {
        let p = prev(Some(LinkStatus::Error), Some(404), Some(0), 1);
        let written = verdict(&p, &probe(Some(404)), 1).unwrap();
        assert_eq!(written.status, LinkStatus::Error);
    }

    #[test]
    fn strike_after_unrelated_500_does_not_give_dead() {
        let p = prev(Some(LinkStatus::Error), Some(500), Some(0), 1);
        let written = verdict(&p, &probe(Some(404)), 25 * 3600).unwrap();
        assert_eq!(written.status, LinkStatus::Error);
    }

    #[test]
    fn strike_pair_can_mix_404_and_410() {
        let p = prev(Some(LinkStatus::Error), Some(404), Some(0), 1);
        let written = verdict(&p, &probe(Some(410)), 25 * 3600).unwrap();
        assert_eq!(written.status, LinkStatus::Dead);
    }

    #[test]
    fn server_error_gives_error_and_increments_fail_count() {
        let p = prev(None, None, None, 0);
        let written = verdict(&p, &probe(Some(500)), 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Error);
        assert_eq!(written.fail_count, 1);
    }

    #[test]
    fn network_failure_gives_error_with_no_code_and_a_reason() {
        let p = prev(None, None, None, 0);
        let net_probe = Probe { http_status: None, cf_challenge: false, net: Some(NetKind::Timeout) };
        let written = verdict(&p, &net_probe, 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Error);
        assert_eq!(written.http_status, None);
        assert_eq!(written.reason, Some(NetKind::Timeout));
        assert_eq!(written.fail_count, 1);
    }

    #[test]
    fn a_coded_response_clears_the_net_reason() {
        let p = prev(Some(LinkStatus::Error), None, Some(0), 1);
        let written = verdict(&p, &probe(Some(200)), 1_000).unwrap();
        assert_eq!(written.status, LinkStatus::Ok);
        assert_eq!(written.reason, None);
    }

    #[test]
    fn due_for_check_picks_unfetched_stale_error_and_week_old_rows() {
        let conn = setup();
        let unfetched = insert_bookmark(&conn, "https://example.test/unfetched");
        let stale_error = insert_bookmark(&conn, "https://example.test/stale-error");
        let week_old_ok = insert_bookmark(&conn, "https://example.test/week-old-ok");
        let fresh_ok = insert_bookmark(&conn, "https://example.test/fresh-ok");
        set_checked(&conn, stale_error, "error", Some(500), 1, STRIKE_INTERVAL_SECS + 10);
        set_checked(&conn, week_old_ok, "ok", Some(200), 0, STALE_SECS + 10);
        set_checked(&conn, fresh_ok, "ok", Some(200), 0, 3 * 86_400);

        let ids = [unfetched, stale_error, week_old_ok, fresh_ok];
        let due = due_for_check(&conn, &ids, false, STALE_SECS).unwrap();
        let due_ids: Vec<i64> = due.iter().map(|(id, _)| *id).collect();

        assert!(due_ids.contains(&unfetched));
        assert!(due_ids.contains(&stale_error));
        assert!(due_ids.contains(&week_old_ok));
        assert!(!due_ids.contains(&fresh_ok));
    }

    #[test]
    fn due_for_check_force_ignores_freshness() {
        let conn = setup();
        let fresh_ok = insert_bookmark(&conn, "https://example.test/force-fresh");
        set_checked(&conn, fresh_ok, "ok", Some(200), 0, 3 * 86_400);

        let normal = due_for_check(&conn, &[fresh_ok], false, STALE_SECS).unwrap();
        assert!(normal.is_empty());

        let forced = due_for_check(&conn, &[fresh_ok], true, STALE_SECS).unwrap();
        assert_eq!(forced.len(), 1);
        assert_eq!(forced[0].0, fresh_ok);
    }

    #[test]
    fn due_for_check_is_capped_and_puts_unchecked_first() {
        let conn = setup();
        let checked = insert_bookmark(&conn, "https://example.test/checked-old");
        set_checked(&conn, checked, "error", Some(500), 1, STRIKE_INTERVAL_SECS + 5);
        let unchecked = insert_bookmark(&conn, "https://example.test/unchecked");

        let due = due_for_check(&conn, &[checked, unchecked], false, STALE_SECS).unwrap();
        assert_eq!(due.len(), 2);
        assert_eq!(due[0].0, unchecked);
    }

    #[test]
    fn due_for_check_respects_custom_stale_secs_for_day_and_month_periods() {
        let conn = setup();
        let two_days_old = insert_bookmark(&conn, "https://example.test/two-days-old");
        set_checked(&conn, two_days_old, "ok", Some(200), 0, 2 * 86_400);

        const DAY_SECS: i64 = 86_400;
        const MONTH_SECS: i64 = 30 * 86_400;

        let day_period = due_for_check(&conn, &[two_days_old], false, DAY_SECS).unwrap();
        assert_eq!(day_period.len(), 1);
        assert_eq!(day_period[0].0, two_days_old);

        let month_period = due_for_check(&conn, &[two_days_old], false, MONTH_SECS).unwrap();
        assert!(month_period.is_empty());
    }

    #[test]
    fn due_for_check_idempotent_after_recording_batch() {
        let mut conn = setup();
        let id = insert_bookmark(&conn, "https://example.test/idempotent");

        let first = due_for_check(&conn, &[id], false, STALE_SECS).unwrap();
        assert_eq!(first.len(), 1);

        record_batch(
            &mut conn,
            &[(id, Written { status: LinkStatus::Ok, reason: None, http_status: Some(200), fail_count: 0 })],
        )
        .unwrap();

        let second = due_for_check(&conn, &[id], false, STALE_SECS).unwrap();
        assert!(second.is_empty());
    }

    #[test]
    fn record_batch_writes_both_rows_in_one_transaction_including_network_failure() {
        let mut conn = setup();
        let ok_id = insert_bookmark(&conn, "https://example.test/batch-ok");
        let failed_id = insert_bookmark(&conn, "https://example.test/batch-network-fail");

        record_batch(
            &mut conn,
            &[
                (ok_id, Written { status: LinkStatus::Ok, reason: None, http_status: Some(200), fail_count: 0 }),
                (
                    failed_id,
                    Written { status: LinkStatus::Error, reason: Some(NetKind::Timeout), http_status: None, fail_count: 1 },
                ),
            ],
        )
        .unwrap();

        for id in [ok_id, failed_id] {
            let checked_at: Option<i64> = conn
                .query_row("SELECT last_checked_at FROM bookmarks WHERE id = ?1", params![id], |row| row.get(0))
                .unwrap();
            assert!(checked_at.is_some());
        }
        let reason: Option<String> = conn
            .query_row("SELECT link_reason FROM bookmarks WHERE id = ?1", params![failed_id], |row| row.get(0))
            .unwrap();
        assert_eq!(reason.as_deref(), Some("timeout"));
    }

    #[test]
    fn row_without_a_verdict_is_left_untouched() {
        let mut conn = setup();
        let throttled_id = insert_bookmark(&conn, "https://example.test/throttled");
        let p = prev(None, None, None, 0);
        assert!(verdict(&p, &probe(Some(429)), 1_000).is_none());

        record_batch(&mut conn, &[]).unwrap();

        let checked_at: Option<i64> = conn
            .query_row("SELECT last_checked_at FROM bookmarks WHERE id = ?1", params![throttled_id], |row| row.get(0))
            .unwrap();
        assert_eq!(checked_at, None);
    }

    #[test]
    fn is_enabled_defaults_to_true_when_key_is_absent() {
        let conn = setup();
        assert!(is_enabled(&conn));
    }

    #[test]
    fn is_enabled_is_false_when_key_is_zero() {
        let conn = setup();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('liveness_enabled', '0')",
            [],
        )
        .unwrap();
        assert!(!is_enabled(&conn));
    }
}
