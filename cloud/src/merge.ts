import type { Change } from './fields.ts';

export type Doc = Record<string, { v: unknown; at: number }>;

export type Outcome = 'applied' | 'ignored' | 'too-large';

export const MAX_DOC_BYTES = 8 * 1024;
export const FUTURE_SLACK_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();

export function docBytes(doc: Doc): number {
  return encoder.encode(JSON.stringify(doc)).length;
}

export function clampAt(at: number, now: number): number {
  return at > now + FUTURE_SLACK_MS ? now : at;
}

export function mergeChange(doc: Doc, change: Change, now: number): Outcome {
  const at = clampAt(change.at, now);
  const current = doc[change.field];
  if (current && at <= current.at) {
    return 'ignored';
  }
  doc[change.field] = { v: change.v, at };
  if (docBytes(doc) > MAX_DOC_BYTES) {
    if (current) {
      doc[change.field] = current;
    } else {
      delete doc[change.field];
    }
    return 'too-large';
  }
  return 'applied';
}

export function deletedAt(doc: Doc): number | null {
  const mark = doc.deleted;
  return mark?.v === true ? mark.at : null;
}

export function publicDoc(doc: Doc): Doc {
  const rest = { ...doc };
  delete rest.deleted;
  return rest;
}
