import { Hono } from 'hono';
import type { Env } from '../env.ts';

export const healthRoutes = new Hono<{ Bindings: Env }>().get('/v1/health', async (c) => {
  const db = c.env.DB;
  const [games, seq] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM games').first<number>('n'),
    db.prepare("SELECT value FROM meta WHERE key = 'seq'").first<number>('value'),
  ]);
  return c.json({ ok: true, games: games ?? 0, seq: seq ?? 0 });
});
