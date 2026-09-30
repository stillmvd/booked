CREATE TABLE game_updates (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    from_version TEXT NOT NULL,
    to_version TEXT NOT NULL,
    at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX game_updates_game ON game_updates(game_id, at);
