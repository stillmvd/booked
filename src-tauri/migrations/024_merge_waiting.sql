UPDATE games SET passed_version = version_installed WHERE status = 'finished' AND passed_version IS NULL;

UPDATE games SET status = 'finished' WHERE status = 'waiting';
