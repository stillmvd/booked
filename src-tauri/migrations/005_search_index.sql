ALTER TABLE bookmarks ADD COLUMN host TEXT GENERATED ALWAYS AS (
    lower(
        CASE
            WHEN instr(url_normalized, '://') = 0 THEN ''
            WHEN instr(substr(url_normalized, instr(url_normalized, '://') + 3), '/') > 0
                THEN substr(
                    substr(url_normalized, instr(url_normalized, '://') + 3),
                    1,
                    instr(substr(url_normalized, instr(url_normalized, '://') + 3), '/') - 1
                )
            ELSE substr(url_normalized, instr(url_normalized, '://') + 3)
        END
    )
) VIRTUAL;

ALTER TABLE bookmarks ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE folders ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE folders ADD COLUMN path TEXT NOT NULL DEFAULT '';

UPDATE bookmarks SET tags = (
    SELECT COALESCE(group_concat(t.name, ' '), '')
    FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
    WHERE bt.bookmark_id = bookmarks.id
);

UPDATE folders SET tags = (
    SELECT COALESCE(group_concat(t.name, ' '), '')
    FROM folder_tags ft JOIN tags t ON t.id = ft.tag_id
    WHERE ft.folder_id = folders.id
);

WITH RECURSIVE tree(id, path) AS (
    SELECT id, '/' || id || '/' FROM folders WHERE parent_id IS NULL
    UNION ALL
    SELECT f.id, tree.path || f.id || '/'
    FROM folders f JOIN tree ON f.parent_id = tree.id
)
UPDATE folders SET path = (SELECT path FROM tree WHERE tree.id = folders.id);

CREATE INDEX idx_folders_path ON folders(path);

CREATE VIRTUAL TABLE bookmarks_fts USING fts5(
    title, tags, description, host, url,
    content='bookmarks', content_rowid='id',
    tokenize="unicode61 remove_diacritics 2"
);

CREATE VIRTUAL TABLE folders_fts USING fts5(
    name, tags, description,
    content='folders', content_rowid='id',
    tokenize="unicode61 remove_diacritics 2"
);

INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('rebuild');
INSERT INTO folders_fts(folders_fts) VALUES('rebuild');

CREATE TRIGGER bookmarks_ai AFTER INSERT ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(rowid, title, tags, description, host, url)
    VALUES (new.id, new.title, new.tags, new.description, new.host, new.url);
END;

CREATE TRIGGER bookmarks_ad AFTER DELETE ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, tags, description, host, url)
    VALUES ('delete', old.id, old.title, old.tags, old.description, old.host, old.url);
END;

CREATE TRIGGER bookmarks_au AFTER UPDATE OF title, description, url, tags ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, tags, description, host, url)
    VALUES ('delete', old.id, old.title, old.tags, old.description, old.host, old.url);
    INSERT INTO bookmarks_fts(rowid, title, tags, description, host, url)
    VALUES (new.id, new.title, new.tags, new.description, new.host, new.url);
END;

CREATE TRIGGER bookmark_tags_ai AFTER INSERT ON bookmark_tags BEGIN
    UPDATE bookmarks SET tags = (
        SELECT COALESCE(group_concat(t.name, ' '), '')
        FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
        WHERE bt.bookmark_id = new.bookmark_id
    ) WHERE id = new.bookmark_id;
END;

CREATE TRIGGER bookmark_tags_ad AFTER DELETE ON bookmark_tags BEGIN
    UPDATE bookmarks SET tags = (
        SELECT COALESCE(group_concat(t.name, ' '), '')
        FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
        WHERE bt.bookmark_id = old.bookmark_id
    ) WHERE id = old.bookmark_id;
END;

CREATE TRIGGER folders_ai AFTER INSERT ON folders BEGIN
    INSERT INTO folders_fts(rowid, name, tags, description)
    VALUES (new.id, new.name, new.tags, new.description);
END;

CREATE TRIGGER folders_ad AFTER DELETE ON folders BEGIN
    INSERT INTO folders_fts(folders_fts, rowid, name, tags, description)
    VALUES ('delete', old.id, old.name, old.tags, old.description);
END;

CREATE TRIGGER folders_au AFTER UPDATE OF name, description, tags ON folders BEGIN
    INSERT INTO folders_fts(folders_fts, rowid, name, tags, description)
    VALUES ('delete', old.id, old.name, old.tags, old.description);
    INSERT INTO folders_fts(rowid, name, tags, description)
    VALUES (new.id, new.name, new.tags, new.description);
END;

CREATE TRIGGER folder_tags_ai AFTER INSERT ON folder_tags BEGIN
    UPDATE folders SET tags = (
        SELECT COALESCE(group_concat(t.name, ' '), '')
        FROM folder_tags ft JOIN tags t ON t.id = ft.tag_id
        WHERE ft.folder_id = new.folder_id
    ) WHERE id = new.folder_id;
END;

CREATE TRIGGER folder_tags_ad AFTER DELETE ON folder_tags BEGIN
    UPDATE folders SET tags = (
        SELECT COALESCE(group_concat(t.name, ' '), '')
        FROM folder_tags ft JOIN tags t ON t.id = ft.tag_id
        WHERE ft.folder_id = old.folder_id
    ) WHERE id = old.folder_id;
END;

CREATE TRIGGER folders_path_ai AFTER INSERT ON folders BEGIN
    UPDATE folders SET path = (
        COALESCE((SELECT path FROM folders WHERE id = new.parent_id), '/') || new.id || '/'
    ) WHERE id = new.id;
END;

CREATE TRIGGER folders_path_au AFTER UPDATE OF parent_id ON folders BEGIN
    UPDATE folders SET path = (
        COALESCE((SELECT path FROM folders WHERE id = new.parent_id), '/') || new.id || '/'
    ) WHERE id = new.id;

    UPDATE folders
    SET path = subtree.path
    FROM (
        WITH RECURSIVE subtree(id, path) AS (
            SELECT id, path FROM folders WHERE id = new.id
            UNION ALL
            SELECT f.id, subtree.path || f.id || '/'
            FROM folders f JOIN subtree ON f.parent_id = subtree.id
        )
        SELECT id, path FROM subtree WHERE id != new.id
    ) AS subtree
    WHERE folders.id = subtree.id;
END;
