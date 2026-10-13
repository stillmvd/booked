CREATE TABLE games (
    thread_id INTEGER PRIMARY KEY,
    seq INTEGER NOT NULL,
    doc TEXT NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX games_seq ON games(seq);

CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);

INSERT INTO meta (key, value) VALUES ('seq', 0), ('purged_before', 0);
