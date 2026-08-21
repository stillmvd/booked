ALTER TABLE bookmarks ADD COLUMN preview_file TEXT;
ALTER TABLE bookmarks ADD COLUMN preview_origin TEXT;
ALTER TABLE bookmarks ADD COLUMN preview_fetched_at INTEGER;

CREATE TABLE favicons (
    host TEXT PRIMARY KEY,
    file TEXT,
    status TEXT NOT NULL,
    fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;
