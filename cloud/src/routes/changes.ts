import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { checkChange, type Change } from '../fields.ts';
import { deletedAt, mergeChange, type Doc, type Outcome } from '../merge.ts';

export const MAX_CHANGES = 200;
export const MAX_BODY_BYTES = 64 * 1024;
const ATTEMPTS = 3;
const ID_CHUNK = 100;

interface Indexed {
  i: number;
  change: Change;
}

interface Row {
  thread_id: number;
  seq: number;
  doc: string;
}

const SEQ_NEXT = "UPDATE meta SET value = value + 1 WHERE key = 'seq'";
const UPSERT =
  "INSERT INTO games (thread_id, seq, doc, deleted_at) VALUES (?1, (SELECT value FROM meta WHERE key = 'seq'), ?2, ?3) " +
  'ON CONFLICT(thread_id) DO UPDATE SET seq = excluded.seq, doc = excluded.doc, deleted_at = excluded.deleted_at ' +
  'WHERE games.seq IS ?4';

async function readRows(db: D1Database, ids: number[]): Promise<Map<number, Row>> {
  const rows = new Map<number, Row>();
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    const marks = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(`SELECT thread_id, seq, doc FROM games WHERE thread_id IN (${marks})`)
      .bind(...chunk)
      .all<Row>();
    for (const row of results) {
      rows.set(row.thread_id, row);
    }
  }
  return rows;
}

export async function applyChanges(
  db: D1Database,
  changes: Indexed[],
  now: number,
): Promise<Map<number, Outcome | 'busy'>> {
  const outcomes = new Map<number, Outcome | 'busy'>();
  const byId = new Map<number, Indexed[]>();
  for (const item of changes) {
    const list = byId.get(item.change.id) ?? [];
    list.push(item);
    byId.set(item.change.id, list);
  }

  let pending = [...byId.keys()];
  for (let attempt = 0; attempt < ATTEMPTS && pending.length > 0; attempt += 1) {
    const rows = await readRows(db, pending);
    const writes: { id: number; doc: Doc; seq: number | null }[] = [];
    for (const id of pending) {
      const row = rows.get(id);
      const doc: Doc = row ? JSON.parse(row.doc) : {};
      let touched = false;
      for (const { i, change } of byId.get(id) ?? []) {
        const outcome = mergeChange(doc, change, now);
        outcomes.set(i, outcome);
        touched ||= outcome === 'applied';
      }
      if (touched) {
        writes.push({ id, doc, seq: row?.seq ?? null });
      }
    }
    if (writes.length === 0) {
      return outcomes;
    }

    const statements = writes.flatMap(({ id, doc, seq }) => [
      db.prepare(SEQ_NEXT),
      db.prepare(UPSERT).bind(id, JSON.stringify(doc), deletedAt(doc), seq),
    ]);
    const results = await db.batch(statements);
    pending = writes.filter((_, n) => (results[n * 2 + 1]?.meta.changes ?? 0) === 0).map((w) => w.id);
  }

  for (const id of pending) {
    for (const { i } of byId.get(id) ?? []) {
      outcomes.set(i, 'busy');
    }
  }
  return outcomes;
}

const REASONS: Record<string, string> = {
  'too-large': 'game doc over 8 KB',
  busy: 'row busy, retry',
};

export const changesRoutes = new Hono<{ Bindings: Env }>().post('/v1/changes', async (c) => {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return c.json({ error: 'body over 64 KB' }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'json expected' }, 400);
  }
  const list = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(list)) {
    return c.json({ error: 'changes array expected' }, 400);
  }
  if (list.length > MAX_CHANGES) {
    return c.json({ error: `over ${MAX_CHANGES} changes` }, 413);
  }

  const rejected: { i: number; reason: string }[] = [];
  const valid: Indexed[] = [];
  list.forEach((item, i) => {
    const checked = checkChange(item);
    if (checked.ok) {
      valid.push({ i, change: checked.change });
    } else {
      rejected.push({ i, reason: checked.reason });
    }
  });

  const outcomes = await applyChanges(c.env.DB, valid, Date.now());
  let applied = 0;
  let ignored = 0;
  for (const [i, outcome] of outcomes) {
    if (outcome === 'applied') {
      applied += 1;
    } else if (outcome === 'ignored') {
      ignored += 1;
    } else {
      rejected.push({ i, reason: REASONS[outcome] ?? outcome });
    }
  }
  rejected.sort((a, b) => a.i - b.i);

  const seq = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'seq'").first<number>('value');
  return c.json({ applied, ignored, rejected, seq: seq ?? 0 });
});
