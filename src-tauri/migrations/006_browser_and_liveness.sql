ALTER TABLE bookmarks ADD COLUMN target_browser TEXT;
ALTER TABLE bookmarks ADD COLUMN target_profile TEXT;
ALTER TABLE bookmarks ADD COLUMN target_profile_name TEXT;
ALTER TABLE bookmarks ADD COLUMN link_status TEXT;
ALTER TABLE bookmarks ADD COLUMN link_reason TEXT;
ALTER TABLE bookmarks ADD COLUMN http_status INTEGER;
ALTER TABLE bookmarks ADD COLUMN last_checked_at INTEGER;
ALTER TABLE bookmarks ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bm_checked ON bookmarks(last_checked_at);
