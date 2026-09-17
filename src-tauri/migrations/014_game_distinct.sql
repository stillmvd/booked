CREATE TABLE game_distinct (
    a_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    b_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id < b_id)
) WITHOUT ROWID;

CREATE INDEX game_distinct_b ON game_distinct(b_id);
