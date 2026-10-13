import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deletedAt, FUTURE_SLACK_MS, mergeChange, publicDoc, type Doc } from './merge.ts';

const NOW = 1_760_000_000_000;

test('newer edit wins, older and equal are ignored', () => {
  const doc: Doc = { rating: { v: 3, at: 100 } };
  assert.equal(mergeChange(doc, { id: 1, field: 'rating', v: 4, at: 99 }, NOW), 'ignored');
  assert.equal(mergeChange(doc, { id: 1, field: 'rating', v: 4, at: 100 }, NOW), 'ignored');
  assert.deepEqual(doc.rating, { v: 3, at: 100 });
  assert.equal(mergeChange(doc, { id: 1, field: 'rating', v: 4, at: 101 }, NOW), 'applied');
  assert.deepEqual(doc.rating, { v: 4, at: 101 });
});

test('different fields do not overwrite each other', () => {
  const doc: Doc = {};
  mergeChange(doc, { id: 1, field: 'rating', v: 4, at: 200 }, NOW);
  mergeChange(doc, { id: 1, field: 'decision', v: 'like', at: 100 }, NOW);
  assert.deepEqual(doc, { rating: { v: 4, at: 200 }, decision: { v: 'like', at: 100 } });
});

test('future time is clamped to now', () => {
  const doc: Doc = {};
  mergeChange(doc, { id: 1, field: 'rating', v: 1, at: NOW + FUTURE_SLACK_MS + 1 }, NOW);
  assert.equal(doc.rating?.at, NOW);
  mergeChange(doc, { id: 1, field: 'title', v: 'a', at: NOW + FUTURE_SLACK_MS }, NOW);
  assert.equal(doc.title?.at, NOW + FUTURE_SLACK_MS);
});

test('a change that grows the doc over 8 KB is refused and rolled back', () => {
  const doc: Doc = { title: { v: 'old', at: 1 } };
  for (let i = 0; i < 30; i += 1) {
    doc[`f${i}`] = { v: 'x'.repeat(200), at: 1 };
  }
  assert.equal(mergeChange(doc, { id: 1, field: 'tags', v: Array(60).fill('x'.repeat(40)), at: 2 }, NOW), 'too-large');
  assert.equal(doc.tags, undefined);
  assert.equal(mergeChange(doc, { id: 1, field: 'title', v: 'y'.repeat(200), at: 2 }, NOW), 'applied');
});

test('deleted mark follows the same rule and stays out of the public doc', () => {
  const doc: Doc = { rating: { v: 2, at: 1 } };
  mergeChange(doc, { id: 1, field: 'deleted', v: true, at: 10 }, NOW);
  assert.equal(deletedAt(doc), 10);
  assert.equal(mergeChange(doc, { id: 1, field: 'deleted', v: false, at: 9 }, NOW), 'ignored');
  assert.equal(deletedAt(doc), 10);
  mergeChange(doc, { id: 1, field: 'deleted', v: false, at: 11 }, NOW);
  assert.equal(deletedAt(doc), null);
  assert.deepEqual(publicDoc(doc), { rating: { v: 2, at: 1 } });
  assert.ok(doc.deleted);
});
