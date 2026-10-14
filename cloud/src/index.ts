import { app } from './app.ts';
import { purgeDeleted, purgeNotes } from './cron.ts';
import type { Env } from './env.ts';

export default {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    const now = Date.now();
    ctx.waitUntil(Promise.all([purgeDeleted(env.DB, now), purgeNotes(env.DB, now)]));
  },
} satisfies ExportedHandler<Env>;
