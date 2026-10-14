import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { purgeDeleted, purgeNotes, KEEP_DELETED_MS, KEEP_DONE_NOTES_MS } from './cron.ts';
import type { Env } from './env.ts';
import { app } from './app.ts';

class FakeStatement {
  private readonly db: DatabaseSync;
  readonly sql: string;
  private readonly params: SQLInputValue[];

  constructor(db: DatabaseSync, sql: string, params: SQLInputValue[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: unknown[]) {
    return new FakeStatement(this.db, this.sql, params as SQLInputValue[]);
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return (column ? row[column] : row) as T;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async run() {
    return this.exec();
  }

  exec() {
    if (/^\s*SELECT/i.test(this.sql)) {
      return { results: this.db.prepare(this.sql).all(...this.params), meta: { changes: 0 } };
    }
    const info = this.db.prepare(this.sql).run(...this.params);
    return { results: [], meta: { changes: Number(info.changes) } };
  }
}

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_games.sql', '0002_notes.sql']) {
    db.exec(readFileSync(fileURLToPath(import.meta.resolve(`../migrations/${file}`)), 'utf8'));
  }
  const d1 = {
    prepare: (sql: string) => new FakeStatement(db, sql),
    batch: async (statements: FakeStatement[]) => {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s.exec());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return { raw: db, d1: d1 as unknown as D1Database };
}

function setup(limit = 1000) {
  const { raw, d1 } = fakeD1();
  let calls = 0;
  const env: Env = {
    DB: d1,
    API_TOKEN: 'dev',
    LIMITER: { limit: async () => ({ success: ++calls <= limit }) } as RateLimit,
  };
  const call = (path: string, init: RequestInit = {}, key: string | null = 'dev') => {
    const headers = new Headers(init.headers);
    if (key !== null) {
      headers.set('authorization', `Bearer ${key}`);
    }
    return app.request(path, { ...init, headers }, env);
  };
  const post = (changes: unknown[], key: string | null = 'dev') =>
    call('/v1/changes', { method: 'POST', body: JSON.stringify({ changes }) }, key);
  return { raw, env, call, post };
}

test('без ключа и с чужим ключом — пустой 404 на любой путь', async () => {
  const { call, post } = setup();
  for (const key of [null, 'wrong', '']) {
    for (const response of [
      await call('/v1/health', {}, key),
      await call('/v1/games?since=0', {}, key),
      await post([{ id: 1, field: 'rating', v: 1, at: 1 }], key),
      await call('/nothing', {}, key),
    ]) {
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '');
    }
  }
  const health = await call('/v1/health');
  assert.deepEqual(await health.json(), { ok: true, games: 0, seq: 0 });
  assert.equal((await call('/nothing')).status, 404);
});

test('сверх лимита — 429 с Retry-After', async () => {
  const { call } = setup(120);
  for (let i = 0; i < 120; i += 1) {
    assert.equal((await call('/v1/health')).status, 200);
  }
  const limited = await call('/v1/health');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('лишнее поле отклонено, остальное применено', async () => {
  const { post, call } = setup();
  const response = await post([
    { id: 318470, field: 'decision', v: 'like', at: 100 },
    { id: 318470, field: 'bookmarks', v: [], at: 100 },
    { id: 318470, field: 'title', v: 'x'.repeat(201), at: 100 },
  ]);
  const body = (await response.json()) as { applied: number; rejected: { i: number }[]; seq: number };
  assert.equal(body.applied, 1);
  assert.deepEqual(body.rejected.map((r) => r.i), [1, 2]);
  assert.equal(body.seq, 1);
  const games = (await (await call('/v1/games?since=0')).json()) as { games: { id: number; doc: unknown }[] };
  assert.deepEqual(games.games[0], {
    id: 318470,
    seq: 1,
    deleted_at: null,
    doc: { decision: { v: 'like', at: 100 } },
  });
});

test('больше 200 правок или 64 КБ — 413, ничего не применено', async () => {
  const { post, call } = setup();
  const many = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, field: 'rating', v: 1, at: 1 }));
  assert.equal((await post(many)).status, 413);
  const big = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, field: 'title', v: 'я'.repeat(200), at: 1 }));
  assert.equal((await post(big)).status, 413);
  assert.deepEqual(await (await call('/v1/health')).json(), { ok: true, games: 0, seq: 0 });
});

test('повтор пачки — ignored, seq не сдвигается; новая правка двигает seq', async () => {
  const { post } = setup();
  const batch = [
    { id: 1, field: 'rating', v: 4, at: 200 },
    { id: 1, field: 'status', v: 'playing', at: 200 },
    { id: 2, field: 'decision', v: 'like', at: 100 },
  ];
  assert.deepEqual(await (await post(batch)).json(), { applied: 3, ignored: 0, rejected: [], seq: 2 });
  assert.deepEqual(await (await post(batch)).json(), { applied: 0, ignored: 3, rejected: [], seq: 2 });
  const next = (await (await post([{ id: 2, field: 'rating', v: 1, at: 300 }])).json()) as { seq: number };
  assert.equal(next.seq, 3);
});

test('выдача постранично по курсору', async () => {
  const { post, call } = setup();
  for (let start = 0; start < 700; start += 200) {
    const chunk = Array.from({ length: Math.min(200, 700 - start) }, (_, i) => ({
      id: start + i + 1,
      field: 'rating',
      v: 3,
      at: 1,
    }));
    assert.equal((await post(chunk)).status, 200);
  }
  const first = (await (await call('/v1/games?since=0')).json()) as { games: unknown[]; next: number; more: boolean };
  assert.equal(first.games.length, 500);
  assert.equal(first.more, true);
  assert.equal(first.next, 500);
  const second = (await (await call(`/v1/games?since=${first.next}`)).json()) as {
    games: unknown[];
    next: number;
    more: boolean;
  };
  assert.equal(second.games.length, 200);
  assert.equal(second.more, false);
  assert.equal(second.next, 700);
  const empty = (await (await call('/v1/games?since=700&limit=10')).json()) as { games: unknown[]; next: number };
  assert.deepEqual(empty, { games: [], next: 700, more: false });
  assert.equal((await call('/v1/games?since=-1')).status, 400);
});

test('удаление: пометка, очистка через 30 дней и reset для старого курсора', async () => {
  const { post, call, env } = setup();
  const now = Date.now();
  const old = now - KEEP_DELETED_MS - 1000;
  await post([
    { id: 1, field: 'rating', v: 2, at: 1 },
    { id: 2, field: 'rating', v: 2, at: 1 },
  ]);
  await post([
    { id: 1, field: 'deleted', v: true, at: old },
    { id: 2, field: 'deleted', v: true, at: now },
  ]);
  const listed = (await (await call('/v1/games?since=2')).json()) as {
    games: { id: number; seq: number; deleted_at: number; doc: Record<string, unknown> }[];
  };
  assert.deepEqual(
    listed.games.map((g) => [g.id, g.deleted_at]),
    [
      [1, old],
      [2, now],
    ],
  );
  assert.equal(listed.games[0]?.doc.deleted, undefined);

  await purgeDeleted(env.DB, now);
  const health = (await (await call('/v1/health')).json()) as { games: number };
  assert.equal(health.games, 1);
  assert.deepEqual(await (await call('/v1/games?since=1')).json(), { reset: true });
  const fromHorizon = (await (await call('/v1/games?since=3')).json()) as { games: { id: number }[] };
  assert.deepEqual(fromHorizon.games.map((g) => g.id), [2]);
  const full = (await (await call('/v1/games?since=0')).json()) as { games: { id: number }[] };
  assert.deepEqual(full.games.map((g) => g.id), [2]);
});

test('гонка: строку изменили между чтением и записью — правка не теряется', async () => {
  const { post, raw, call } = setup();
  await post([{ id: 7, field: 'rating', v: 1, at: 1 }]);
  const realPrepare = raw.prepare.bind(raw);
  let sneaked = false;
  raw.prepare = ((sql: string) => {
    if (!sneaked && sql.startsWith('INSERT INTO games')) {
      sneaked = true;
      realPrepare("UPDATE meta SET value = value + 1 WHERE key = 'seq'").run();
      realPrepare(
        `UPDATE games SET seq = (SELECT value FROM meta WHERE key = 'seq'), doc = json_set(doc, '$.decision', json('{"v":"like","at":5}')) WHERE thread_id = 7`,
      ).run();
    }
    return realPrepare(sql);
  }) as typeof raw.prepare;
  const body = (await (await post([{ id: 7, field: 'status', v: 'new', at: 9 }])).json()) as { applied: number };
  assert.equal(body.applied, 1);
  const games = (await (await call('/v1/games?since=0')).json()) as { games: { doc: Record<string, unknown> }[] };
  assert.deepEqual(Object.keys(games.games[0]?.doc ?? {}).sort(), ['decision', 'rating', 'status']);
});

interface NoteOut {
  id: string;
  app: string;
  kind: string;
  text: string;
  context: unknown;
  created_at: number;
  status: string;
  done_at: number | null;
  reply: string | null;
}

const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  app: 'sorter95',
  kind: 'bug',
  text: 'Плитка мигает при наведении',
  context: { where: 'card', gameId: 309823 },
  at: 1000,
  ...extra,
});

function notesApi(call: ReturnType<typeof setup>['call']) {
  const send = (notes: unknown[], key: string | null = 'dev') =>
    call('/v1/notes', { method: 'POST', body: JSON.stringify({ notes }) }, key);
  const list = async (query = '') => ((await (await call(`/v1/notes${query}`)).json()) as { notes: NoteOut[] }).notes;
  const update = (id: string, body: unknown) => call(`/v1/notes/${id}`, { method: 'POST', body: JSON.stringify(body) });
  return { send, list, update };
}

test('заметки: без ключа 404, новая принята, повтор id не дублируется, кривая отклонена', async () => {
  const { call } = setup();
  const { send, list } = notesApi(call);
  assert.equal((await send([note('a1')], null)).status, 404);
  assert.equal((await call('/v1/notes', {}, 'wrong')).status, 404);

  const first = await send([note('a1'), note('a2', { kind: 'idea', app: 'booked' }), note('bad', { kind: 'question' })]);
  assert.deepEqual(await first.json(), { applied: 2, ignored: 0, rejected: [{ i: 2, reason: 'kind: one of bug, idea expected' }] });
  assert.deepEqual(await (await send([note('a1', { text: 'другой текст' })])).json(), { applied: 0, ignored: 1, rejected: [] });

  const stored = await list();
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0], {
    id: 'a1',
    app: 'sorter95',
    kind: 'bug',
    text: 'Плитка мигает при наведении',
    context: { where: 'card', gameId: 309823 },
    created_at: 1000,
    status: 'open',
    done_at: null,
    reply: null,
  });
});

test('заметки: время из будущего становится текущим, лимит пачки и тела', async () => {
  const { call } = setup();
  const { send, list } = notesApi(call);
  const before = Date.now();
  await send([note('f1', { at: before + 60 * 60 * 1000 })]);
  const [saved] = await list();
  assert.ok(saved && saved.created_at >= before && saved.created_at <= Date.now());
  assert.equal((await send(Array.from({ length: 51 }, (_, i) => note(`n${i}`)))).status, 413);
  assert.equal((await call('/v1/notes', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await call('/v1/notes', { method: 'POST', body: '{"notes":1}' })).status, 400);
});

test('заметки: фильтр по app и status, сортировка по времени, limit', async () => {
  const { call } = setup();
  const { send, list, update } = notesApi(call);
  await send([note('c3', { at: 300 }), note('c1', { at: 100, app: 'booked' }), note('c2', { at: 200 })]);
  await update('c2', { status: 'done', reply: 'Поправлено' });
  assert.deepEqual((await list()).map((n) => n.id), ['c1', 'c2', 'c3']);
  assert.deepEqual((await list('?app=sorter95&status=open')).map((n) => n.id), ['c3']);
  assert.deepEqual((await list('?status=done')).map((n) => n.id), ['c2']);
  assert.deepEqual((await list('?limit=1')).map((n) => n.id), ['c1']);
  assert.equal((await call('/v1/notes?app=other')).status, 400);
  assert.equal((await call('/v1/notes?status=closed')).status, 400);
  assert.equal((await call('/v1/notes?limit=0')).status, 400);
});

test('заметки: done ставит время и ответ, open возвращает без потери ответа, чужой id — 404', async () => {
  const { call } = setup();
  const { send, list, update } = notesApi(call);
  await send([note('d1')]);
  const done = await update('d1', { status: 'done', reply: 'Сделано в 0dd8585' });
  assert.deepEqual(await done.json(), { ok: true });
  let [saved] = await list();
  assert.equal(saved?.status, 'done');
  assert.ok(typeof saved?.done_at === 'number');
  assert.equal(saved?.reply, 'Сделано в 0dd8585');

  await update('d1', { status: 'open' });
  [saved] = await list();
  assert.equal(saved?.status, 'open');
  assert.equal(saved?.done_at, null);
  assert.equal(saved?.reply, 'Сделано в 0dd8585');

  assert.equal((await update('missing', { status: 'done' })).status, 404);
  assert.equal((await update('d1', { status: 'closed' })).status, 400);
  assert.equal((await update('d1', { status: 'done', reply: 'x'.repeat(2001) })).status, 400);
});

test('чистка удаляет только закрытые заметки старше 90 дней', async () => {
  const { raw, env, call } = setup();
  const { send } = notesApi(call);
  await send([note('old'), note('fresh'), note('open')]);
  const now = Date.now();
  raw.prepare("UPDATE notes SET status = 'done', done_at = ?1 WHERE id = 'old'").run(now - KEEP_DONE_NOTES_MS - 1);
  raw.prepare("UPDATE notes SET status = 'done', done_at = ?1 WHERE id = 'fresh'").run(now - 1000);
  await purgeNotes(env.DB, now);
  const left = raw.prepare('SELECT id FROM notes ORDER BY id').all().map((row) => (row as { id: string }).id);
  assert.deepEqual(left, ['fresh', 'open']);
});
