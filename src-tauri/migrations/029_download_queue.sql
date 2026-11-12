CREATE TABLE download_queue (
    game_id INTEGER PRIMARY KEY,
    pos INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'failed')),
    reason TEXT,
    part_dir TEXT,
    part_name TEXT,
    part_total INTEGER
);
