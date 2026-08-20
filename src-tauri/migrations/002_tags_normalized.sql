ALTER TABLE tags ADD COLUMN name_normalized TEXT NOT NULL DEFAULT '';

UPDATE tags SET name_normalized = lower(name);

DROP INDEX IF EXISTS idx_tags_name;

CREATE UNIQUE INDEX idx_tags_name_normalized ON tags(name_normalized);
