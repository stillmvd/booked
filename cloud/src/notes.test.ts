import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNote, checkUpdate } from './notes.ts';

const base = { id: '0d7f6c1e-2b9a-4c4e-9c1f-2a1b3c4d5e6f', app: 'booked', kind: 'idea', text: ' Ссылки у игр ', at: 5 };
const ok = (extra: Record<string, unknown>) => checkNote({ ...base, ...extra }, 10).ok;

test('заметка: uuid, приложение, вид, текст и контекст по контракту', () => {
  const checked = checkNote(base, 10);
  assert.deepEqual(checked, {
    ok: true,
    note: { id: base.id, app: 'booked', kind: 'idea', text: 'Ссылки у игр', context: null, createdAt: 5 },
  });
  assert.equal(ok({ context: { where: 'card', gameId: 1 } }), true);
  assert.equal(ok({ text: 'x'.repeat(2000) }), true);
  assert.equal(ok({ context: { s: 'x'.repeat(1016) } }), true);
});

test('заметка: всё остальное отклонено', () => {
  assert.equal(ok({ id: '' }), false);
  assert.equal(ok({ id: 'a b' }), false);
  assert.equal(ok({ id: 'x'.repeat(65) }), false);
  assert.equal(ok({ app: 'chrome' }), false);
  assert.equal(ok({ kind: 'question' }), false);
  assert.equal(ok({ text: '   ' }), false);
  assert.equal(ok({ text: 'x'.repeat(2001) }), false);
  assert.equal(ok({ context: 'card' }), false);
  assert.equal(ok({ context: [1] }), false);
  assert.equal(ok({ context: { s: 'x'.repeat(1017) } }), false);
  assert.equal(ok({ at: -1 }), false);
  assert.equal(ok({ at: 1.5 }), false);
  assert.equal(checkNote(null, 10).ok, false);
  assert.equal(checkNote([base], 10).ok, false);
});

test('заметка: время больше чем на 5 минут вперёд становится текущим', () => {
  const now = 1_000_000;
  const at = (value: number) => {
    const checked = checkNote({ ...base, at: value }, now);
    return checked.ok ? checked.note.createdAt : -1;
  };
  assert.equal(at(now + 5 * 60 * 1000), now + 5 * 60 * 1000);
  assert.equal(at(now + 5 * 60 * 1000 + 1), now);
});

test('правка заметки: статус open или done, ответ строкой до 2000 или null', () => {
  assert.deepEqual(checkUpdate({ status: 'done', reply: 'ок' }), { ok: true, status: 'done', reply: 'ок' });
  assert.deepEqual(checkUpdate({ status: 'open' }), { ok: true, status: 'open', reply: undefined });
  assert.equal(checkUpdate({ status: 'done', reply: null }).ok, true);
  assert.equal(checkUpdate({ status: 'closed' }).ok, false);
  assert.equal(checkUpdate({ status: 'done', reply: 5 }).ok, false);
  assert.equal(checkUpdate({ status: 'done', reply: 'x'.repeat(2001) }).ok, false);
  assert.equal(checkUpdate(null).ok, false);
});
