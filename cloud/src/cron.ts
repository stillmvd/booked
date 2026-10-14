export const KEEP_DELETED_MS = 30 * 24 * 60 * 60 * 1000;
export const KEEP_DONE_NOTES_MS = 90 * 24 * 60 * 60 * 1000;

export async function purgeNotes(db: D1Database, now: number): Promise<void> {
  await db.prepare("DELETE FROM notes WHERE status = 'done' AND done_at < ?1").bind(now - KEEP_DONE_NOTES_MS).run();
}

export async function purgeDeleted(db: D1Database, now: number): Promise<void> {
  const horizon = now - KEEP_DELETED_MS;
  await db.batch([
    db
      .prepare(
        "UPDATE meta SET value = MAX(value, COALESCE((SELECT MAX(seq) FROM games WHERE deleted_at IS NOT NULL AND deleted_at < ?1), 0)) WHERE key = 'purged_before'",
      )
      .bind(horizon),
    db.prepare('DELETE FROM games WHERE deleted_at IS NOT NULL AND deleted_at < ?1').bind(horizon),
  ]);
}
