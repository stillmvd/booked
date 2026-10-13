export interface Change {
  id: number;
  field: string;
  v: unknown;
  at: number;
}

export type Checked = { ok: true; change: Change } | { ok: false; reason: string };

const COVER_HOSTS = ['https://attachments.f95zone.to/', 'https://preview.f95zone.to/'];

const text = (max: number) => (v: unknown) =>
  typeof v === 'string' && v.length <= max ? null : `string up to ${max} chars expected`;

const oneOf = (values: readonly unknown[]) => (v: unknown) =>
  values.includes(v) ? null : `one of ${values.map(String).join(', ')} expected`;

const bool = (v: unknown) => (typeof v === 'boolean' ? null : 'boolean expected');

const intIn = (min: number, max: number) => (v: unknown) =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max
    ? null
    : `integer ${min}..${max} expected`;

const FIELDS: Record<string, (v: unknown) => string | null> = {
  decision: oneOf(['like', 'dislike', null]),
  likedVersion: text(64),
  status: oneOf(['wish', 'new', 'playing', 'finished', 'waiting', 'disliked', null]),
  rating: intIn(0, 5),
  inLibrary: bool,
  installedVersion: text(64),
  siteVersion: text(64),
  title: text(200),
  cover: (v) =>
    text(300)(v) ?? (COVER_HOSTS.some((host) => (v as string).startsWith(host)) ? null : 'f95 image url expected'),
  engine: text(40),
  devStatus: text(20),
  tags: (v) =>
    Array.isArray(v) && v.length <= 60 && v.every((tag) => text(40)(tag) === null)
      ? null
      : 'up to 60 strings of up to 40 chars expected',
  size: intIn(0, Number.MAX_SAFE_INTEGER),
  deleted: bool,
};

export function checkChange(raw: unknown): Checked {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'object expected' };
  }
  const { id, field, v, at } = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(id) || (id as number) <= 0) {
    return { ok: false, reason: 'id must be a positive integer' };
  }
  if (!Number.isSafeInteger(at) || (at as number) < 0) {
    return { ok: false, reason: 'at must be a non-negative integer' };
  }
  if (typeof field !== 'string' || !Object.hasOwn(FIELDS, field)) {
    return { ok: false, reason: `unknown field ${String(field)}` };
  }
  if (v === undefined) {
    return { ok: false, reason: `${field}: value missing` };
  }
  const problem = FIELDS[field]?.(v);
  if (problem) {
    return { ok: false, reason: `${field}: ${problem}` };
  }
  return { ok: true, change: { id: id as number, field, v, at: at as number } };
}
