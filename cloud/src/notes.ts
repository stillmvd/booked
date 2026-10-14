export const NOTE_APPS = ['sorter95', 'booked'] as const;
export const NOTE_KINDS = ['bug', 'idea'] as const;
export const NOTE_STATUSES = ['open', 'done'] as const;
export const MAX_TEXT = 2000;
export const MAX_CONTEXT_BYTES = 1024;
export const FUTURE_SLACK_MS = 5 * 60 * 1000;

export interface Note {
  id: string;
  app: string;
  kind: string;
  text: string;
  context: string | null;
  createdAt: number;
}

export type CheckedNote = { ok: true; note: Note } | { ok: false; reason: string };

const ID = /^[A-Za-z0-9-]{1,64}$/;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export function checkNote(raw: unknown, now: number): CheckedNote {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'object expected' };
  }
  const { id, app, kind, text, context, at } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !ID.test(id)) {
    return { ok: false, reason: 'id: 1..64 letters, digits or dashes expected' };
  }
  if (!NOTE_APPS.includes(app as (typeof NOTE_APPS)[number])) {
    return { ok: false, reason: `app: one of ${NOTE_APPS.join(', ')} expected` };
  }
  if (!NOTE_KINDS.includes(kind as (typeof NOTE_KINDS)[number])) {
    return { ok: false, reason: `kind: one of ${NOTE_KINDS.join(', ')} expected` };
  }
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length < 1 || trimmed.length > MAX_TEXT) {
    return { ok: false, reason: `text: 1..${MAX_TEXT} chars expected` };
  }
  let stored: string | null = null;
  if (context !== undefined && context !== null) {
    if (typeof context !== 'object' || Array.isArray(context)) {
      return { ok: false, reason: 'context: object expected' };
    }
    stored = JSON.stringify(context);
    if (byteLength(stored) > MAX_CONTEXT_BYTES) {
      return { ok: false, reason: `context: up to ${MAX_CONTEXT_BYTES} bytes of JSON expected` };
    }
  }
  if (!Number.isSafeInteger(at) || (at as number) < 0) {
    return { ok: false, reason: 'at: non-negative integer expected' };
  }
  const createdAt = (at as number) > now + FUTURE_SLACK_MS ? now : (at as number);
  return { ok: true, note: { id, app: app as string, kind: kind as string, text: trimmed, context: stored, createdAt } };
}

export type CheckedUpdate = { ok: true; status: string; reply: string | null | undefined } | { ok: false; reason: string };

export function checkUpdate(raw: unknown): CheckedUpdate {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'object expected' };
  }
  const { status, reply } = raw as Record<string, unknown>;
  if (!NOTE_STATUSES.includes(status as (typeof NOTE_STATUSES)[number])) {
    return { ok: false, reason: `status: one of ${NOTE_STATUSES.join(', ')} expected` };
  }
  if (reply !== undefined && reply !== null && (typeof reply !== 'string' || reply.length > MAX_TEXT)) {
    return { ok: false, reason: `reply: string up to ${MAX_TEXT} chars or null expected` };
  }
  return { ok: true, status: status as string, reply: reply as string | null | undefined };
}
