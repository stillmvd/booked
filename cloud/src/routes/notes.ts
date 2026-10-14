import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { checkNote, checkUpdate, NOTE_APPS, NOTE_STATUSES, type Note } from '../notes.ts';

export const MAX_NOTES = 50;
export const MAX_NOTES_BODY_BYTES = 256 * 1024;
export const MAX_NOTES_LIMIT = 200;

interface NoteRow {
  id: string;
  app: string;
  kind: string;
  text: string;
  context: string | null;
  created_at: number;
  status: string;
  done_at: number | null;
  reply: string | null;
}

function parseContext(raw: string | null): unknown {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJson(raw: string): { ok: true; body: unknown } | { ok: false } {
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export const notesRoutes = new Hono<{ Bindings: Env }>()
  .post('/v1/notes', async (c) => {
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).length > MAX_NOTES_BODY_BYTES) {
      return c.json({ error: 'body over 256 KB' }, 413);
    }
    const parsed = readJson(raw);
    if (!parsed.ok) {
      return c.json({ error: 'json expected' }, 400);
    }
    const list = (parsed.body as { notes?: unknown } | null)?.notes;
    if (!Array.isArray(list)) {
      return c.json({ error: 'notes array expected' }, 400);
    }
    if (list.length > MAX_NOTES) {
      return c.json({ error: `over ${MAX_NOTES} notes` }, 413);
    }
    const now = Date.now();
    const rejected: { i: number; reason: string }[] = [];
    const valid: Note[] = [];
    list.forEach((item, i) => {
      const checked = checkNote(item, now);
      if (checked.ok) {
        valid.push(checked.note);
      } else {
        rejected.push({ i, reason: checked.reason });
      }
    });
    let applied = 0;
    if (valid.length > 0) {
      const db = c.env.DB;
      const results = await db.batch(
        valid.map((note) =>
          db
            .prepare(
              'INSERT OR IGNORE INTO notes (id, app, kind, text, context, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
            )
            .bind(note.id, note.app, note.kind, note.text, note.context, note.createdAt),
        ),
      );
      applied = results.reduce((sum, result) => sum + (result.meta.changes > 0 ? 1 : 0), 0);
    }
    return c.json({ applied, ignored: valid.length - applied, rejected });
  })
  .get('/v1/notes', async (c) => {
    const app = c.req.query('app');
    const status = c.req.query('status');
    const limitRaw = c.req.query('limit');
    if (app !== undefined && !NOTE_APPS.includes(app as (typeof NOTE_APPS)[number])) {
      return c.json({ error: `app must be one of ${NOTE_APPS.join(', ')}` }, 400);
    }
    if (status !== undefined && !NOTE_STATUSES.includes(status as (typeof NOTE_STATUSES)[number])) {
      return c.json({ error: `status must be one of ${NOTE_STATUSES.join(', ')}` }, 400);
    }
    const asked = limitRaw === undefined ? MAX_NOTES_LIMIT : Number(limitRaw);
    if (!Number.isSafeInteger(asked) || asked < 1) {
      return c.json({ error: 'limit must be a positive integer' }, 400);
    }
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM notes WHERE (?1 IS NULL OR app = ?1) AND (?2 IS NULL OR status = ?2) ORDER BY created_at, id LIMIT ?3',
    )
      .bind(app ?? null, status ?? null, Math.min(asked, MAX_NOTES_LIMIT))
      .all<NoteRow>();
    return c.json({ notes: results.map((row) => ({ ...row, context: parseContext(row.context) })) });
  })
  .post('/v1/notes/:id', async (c) => {
    const parsed = readJson(await c.req.text());
    if (!parsed.ok) {
      return c.json({ error: 'json expected' }, 400);
    }
    const checked = checkUpdate(parsed.body);
    if (!checked.ok) {
      return c.json({ error: checked.reason }, 400);
    }
    const doneAt = checked.status === 'done' ? Date.now() : null;
    const keepReply = checked.reply === undefined;
    const result = await c.env.DB.prepare(
      'UPDATE notes SET status = ?1, done_at = ?2, reply = CASE WHEN ?4 THEN reply ELSE ?3 END WHERE id = ?5',
    )
      .bind(checked.status, doneAt, checked.reply ?? null, keepReply ? 1 : 0, c.req.param('id'))
      .run();
    if (result.meta.changes === 0) {
      return c.json({ error: 'note not found' }, 404);
    }
    return c.json({ ok: true });
  });
