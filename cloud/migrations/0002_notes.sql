CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    context TEXT,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    done_at INTEGER,
    reply TEXT
);

CREATE INDEX notes_created ON notes(created_at);
