CREATE TABLE folders (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    image TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    url_normalized TEXT NOT NULL,
    description TEXT,
    image TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE
);

CREATE TABLE bookmark_tags (
    bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (bookmark_id, tag_id)
) WITHOUT ROWID;

CREATE TABLE folder_tags (
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX idx_folders_parent ON folders(parent_id, sort);
CREATE INDEX idx_bookmarks_folder ON bookmarks(folder_id, sort);
CREATE UNIQUE INDEX idx_tags_name ON tags(name);
CREATE INDEX idx_bookmarks_url_normalized ON bookmarks(url_normalized);
