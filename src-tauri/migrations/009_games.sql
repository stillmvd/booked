CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    base_name TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    folder_path TEXT,
    folder_name TEXT,
    version_installed TEXT,
    version_source TEXT NOT NULL DEFAULT 'folder',
    source TEXT,
    page_url TEXT,
    image TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    rating INTEGER NOT NULL DEFAULT 0,
    exe_path TEXT,
    exe_source TEXT NOT NULL DEFAULT 'auto',
    size_bytes INTEGER,
    last_launched_at INTEGER,
    site_version TEXT,
    seen_version TEXT,
    skipped_version TEXT,
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE game_tags (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (game_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX game_tags_tag ON game_tags(tag_id);
