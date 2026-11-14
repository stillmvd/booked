CREATE TABLE download_queue_new (
    game_id INTEGER PRIMARY KEY,
    pos INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('waiting', 'queued', 'failed')),
    reason TEXT,
    archive TEXT,
    added_at INTEGER NOT NULL
);
INSERT INTO download_queue_new (game_id, pos, state, reason, archive, added_at)
SELECT game_id, pos,
       CASE WHEN state = 'failed' THEN 'failed' ELSE 'waiting' END,
       CASE WHEN state = 'failed' AND reason IN ('no-space', 'unpack') THEN reason
            WHEN state = 'failed' THEN 'other' END,
       NULL,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM download_queue;
DROP TABLE download_queue;
ALTER TABLE download_queue_new RENAME TO download_queue;
