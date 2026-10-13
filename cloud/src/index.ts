import { app } from './app.ts';
import { purgeDeleted } from './cron.ts';
import type { Env } from './env.ts';

export default {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(purgeDeleted(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
