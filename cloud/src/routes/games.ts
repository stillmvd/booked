import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { publicDoc, type Doc } from '../merge.ts';

export const MAX_LIMIT = 500;

interface Row {
  thread_id: number;
  seq: number;
  doc: string;
  deleted_at: number | null;
}

function intParam(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export const gamesRoutes = new Hono<{ Bindings: Env }>().get('/v1/games', async (c) => {
  const since = intParam(c.req.query('since'), 0);
  const asked = intParam(c.req.query('limit'), MAX_LIMIT);
  if (since === null || asked === null) {
    return c.json({ error: 'since and limit must be non-negative integers' }, 400);
  }
  const limit = Math.min(Math.max(asked, 1), MAX_LIMIT);

  const db = c.env.DB;
  const purged = (await db.prepare("SELECT value FROM meta WHERE key = 'purged_before'").first<number>('value')) ?? 0;
  if (since > 0 && since < purged) {
    return c.json({ reset: true });
  }

  const { results } = await db
    .prepare('SELECT thread_id, seq, doc, deleted_at FROM games WHERE seq > ?1 ORDER BY seq LIMIT ?2')
    .bind(since, limit + 1)
    .all<Row>();
  const page = results.slice(0, limit);
  return c.json({
    games: page.map((row) => ({
      id: row.thread_id,
      seq: row.seq,
      deleted_at: row.deleted_at,
      doc: publicDoc(JSON.parse(row.doc) as Doc),
    })),
    next: page.at(-1)?.seq ?? since,
    more: results.length > limit,
  });
});
