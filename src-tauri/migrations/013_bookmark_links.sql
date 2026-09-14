CREATE TABLE bookmark_links (
    id              INTEGER PRIMARY KEY,
    bookmark_id     INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    sort            INTEGER NOT NULL DEFAULT 0,
    url             TEXT NOT NULL,
    url_normalized  TEXT NOT NULL,
    label           TEXT,
    link_status     TEXT,
    link_reason     TEXT,
    http_status     INTEGER,
    last_checked_at INTEGER,
    fail_count      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_bookmark_links_bookmark ON bookmark_links(bookmark_id, sort);
CREATE INDEX idx_bookmark_links_normalized ON bookmark_links(url_normalized);
CREATE INDEX idx_bookmark_links_checked ON bookmark_links(last_checked_at);

ALTER TABLE bookmarks ADD COLUMN image_x REAL NOT NULL DEFAULT 50;
ALTER TABLE bookmarks ADD COLUMN image_y REAL NOT NULL DEFAULT 50;
ALTER TABLE bookmarks ADD COLUMN links_text TEXT NOT NULL DEFAULT '';
ALTER TABLE bookmarks ADD COLUMN link_labels TEXT NOT NULL DEFAULT '';

INSERT INTO bookmark_links (bookmark_id, sort, url, url_normalized, link_status, link_reason, http_status, last_checked_at, fail_count)
SELECT id, 0, url, url_normalized, link_status, link_reason, http_status, last_checked_at, fail_count FROM bookmarks;

DROP TRIGGER bookmarks_ai;
DROP TRIGGER bookmarks_ad;
DROP TRIGGER bookmarks_au;
DROP TABLE bookmarks_fts;

UPDATE bookmarks SET links_text = url;

CREATE VIRTUAL TABLE bookmarks_fts USING fts5(
    title, tags, description, host, url, links_text, link_labels,
    content='bookmarks', content_rowid='id',
    tokenize="unicode61 remove_diacritics 2"
);

INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('rebuild');

CREATE TRIGGER bookmarks_ai AFTER INSERT ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(rowid, title, tags, description, host, url, links_text, link_labels)
    VALUES (new.id, new.title, new.tags, new.description, new.host, new.url, new.links_text, new.link_labels);
END;

CREATE TRIGGER bookmarks_ad AFTER DELETE ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, tags, description, host, url, links_text, link_labels)
    VALUES ('delete', old.id, old.title, old.tags, old.description, old.host, old.url, old.links_text, old.link_labels);
END;

CREATE TRIGGER bookmarks_au AFTER UPDATE OF title, description, url, tags, links_text, link_labels ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, tags, description, host, url, links_text, link_labels)
    VALUES ('delete', old.id, old.title, old.tags, old.description, old.host, old.url, old.links_text, old.link_labels);
    INSERT INTO bookmarks_fts(rowid, title, tags, description, host, url, links_text, link_labels)
    VALUES (new.id, new.title, new.tags, new.description, new.host, new.url, new.links_text, new.link_labels);
END;
