import { Hono } from 'hono';
import { tokenMatches } from './auth.ts';
import type { Env } from './env.ts';
import { changesRoutes } from './routes/changes.ts';
import { gamesRoutes } from './routes/games.ts';
import { healthRoutes } from './routes/health.ts';

const RETRY_AFTER_SECONDS = 60;

export const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  if (!tokenMatches(c.req.header('authorization'), c.env.API_TOKEN)) {
    return c.body(null, 404);
  }
  const { success } = await c.env.LIMITER.limit({ key: 'api' });
  if (!success) {
    c.header('Retry-After', String(RETRY_AFTER_SECONDS));
    return c.body(null, 429);
  }
  await next();
});

app.notFound((c) => c.body(null, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

app.route('/', healthRoutes);
app.route('/', changesRoutes);
app.route('/', gamesRoutes);
