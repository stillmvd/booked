ALTER TABLE games ADD COLUMN passed_version TEXT;

UPDATE games SET passed_version = version_installed WHERE status = 'waiting';
