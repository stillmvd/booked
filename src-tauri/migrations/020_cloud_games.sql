ALTER TABLE games ADD COLUMN f95_thread_id INTEGER;
ALTER TABLE games ADD COLUMN field_at TEXT;

CREATE UNIQUE INDEX games_f95_thread ON games(f95_thread_id) WHERE f95_thread_id IS NOT NULL;

CREATE TABLE sync_outbox (
    id INTEGER PRIMARY KEY,
    thread_id INTEGER NOT NULL,
    field TEXT NOT NULL,
    value,
    at INTEGER NOT NULL
);

CREATE TRIGGER games_cloud_update
AFTER UPDATE OF status, rating, version_installed, site_version, title, title_source, engine, folder_path ON games
WHEN new.f95_thread_id IS NOT NULL AND old.f95_thread_id IS new.f95_thread_id
BEGIN
    INSERT INTO sync_outbox (thread_id, field, value, at)
    SELECT new.f95_thread_id, f, v, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM (
        SELECT 'status' AS f, new.status AS v WHERE old.status IS NOT new.status
        UNION ALL SELECT 'rating', new.rating WHERE old.rating IS NOT new.rating
        UNION ALL SELECT 'installedVersion', new.version_installed
            WHERE old.version_installed IS NOT new.version_installed
        UNION ALL SELECT 'siteVersion', new.site_version WHERE old.site_version IS NOT new.site_version
        UNION ALL SELECT 'title', new.title
            WHERE new.title_source != 'folder'
              AND (old.title IS NOT new.title OR old.title_source IS NOT new.title_source)
        UNION ALL SELECT 'engine', new.engine
            WHERE old.engine IS NOT new.engine AND new.engine IS NOT NULL AND new.engine != 'Other'
        UNION ALL SELECT 'inLibrary', new.folder_path IS NOT NULL
            WHERE (old.folder_path IS NULL) != (new.folder_path IS NULL)
    );
END;

CREATE TRIGGER games_cloud_delete
AFTER DELETE ON games
WHEN old.f95_thread_id IS NOT NULL
BEGIN
    INSERT INTO sync_outbox (thread_id, field, value, at)
    VALUES (old.f95_thread_id, 'deleted', 1, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;

CREATE TRIGGER sync_outbox_field_at
AFTER INSERT ON sync_outbox
BEGIN
    UPDATE games SET field_at = json_set(COALESCE(field_at, '{}'), '$.' || new.field, new.at)
    WHERE f95_thread_id = new.thread_id;
END;
