ALTER TABLE games ADD COLUMN dev_status TEXT;
ALTER TABLE games ADD COLUMN cover_url TEXT;

UPDATE games SET status = 'disliked' WHERE status = 'dropped';
