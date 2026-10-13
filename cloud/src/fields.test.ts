import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkChange } from './fields.ts';

const ok = (field: string, v: unknown) => checkChange({ id: 1, field, v, at: 1 }).ok;

test('accepts every contract field with a valid value', () => {
  assert.equal(ok('decision', 'like'), true);
  assert.equal(ok('decision', null), true);
  assert.equal(ok('likedVersion', 'v0.5'), true);
  assert.equal(ok('status', 'waiting'), true);
  assert.equal(ok('status', null), true);
  assert.equal(ok('rating', 0), true);
  assert.equal(ok('rating', 5), true);
  assert.equal(ok('inLibrary', false), true);
  assert.equal(ok('installedVersion', 'x'.repeat(64)), true);
  assert.equal(ok('siteVersion', '0.6'), true);
  assert.equal(ok('title', 'x'.repeat(200)), true);
  assert.equal(ok('cover', 'https://attachments.f95zone.to/2026/10/1.jpg'), true);
  assert.equal(ok('cover', 'https://preview.f95zone.to/2026/10/1.jpg'), true);
  assert.equal(ok('engine', "Ren'Py"), true);
  assert.equal(ok('devStatus', 'Completed'), true);
  assert.equal(ok('tags', Array.from({ length: 60 }, () => 'x'.repeat(40))), true);
  assert.equal(ok('size', 0), true);
  assert.equal(ok('deleted', true), true);
});

test('rejects wrong types, lengths and formats', () => {
  assert.equal(ok('decision', 'maybe'), false);
  assert.equal(ok('status', 'dropped'), false);
  assert.equal(ok('rating', 7), false);
  assert.equal(ok('rating', 2.5), false);
  assert.equal(ok('inLibrary', 1), false);
  assert.equal(ok('installedVersion', 'x'.repeat(65)), false);
  assert.equal(ok('siteVersion', null), false);
  assert.equal(ok('title', 'x'.repeat(201)), false);
  assert.equal(ok('cover', 'https://example.com/a.jpg'), false);
  assert.equal(ok('cover', `https://attachments.f95zone.to/${'x'.repeat(300)}`), false);
  assert.equal(ok('engine', 'x'.repeat(41)), false);
  assert.equal(ok('devStatus', 'x'.repeat(21)), false);
  assert.equal(ok('tags', Array.from({ length: 61 }, () => 'a')), false);
  assert.equal(ok('tags', ['x'.repeat(41)]), false);
  assert.equal(ok('tags', 'a'), false);
  assert.equal(ok('size', -1), false);
  assert.equal(ok('deleted', 'yes'), false);
});

test('links accept up to 12 host and https url pairs', () => {
  const link = (host: string, url: string) => ({ host, url });
  assert.equal(ok('links', []), true);
  assert.equal(ok('links', [link('MEGA', 'https://f95zone.to/masked/mega.nz/2/123/abc')]), true);
  assert.equal(ok('links', Array.from({ length: 12 }, () => link('x'.repeat(30), `https://${'x'.repeat(292)}`))), true);
  assert.equal(ok('links', Array.from({ length: 13 }, () => link('MEGA', 'https://mega.nz/a'))), false);
  assert.equal(ok('links', [link('', 'https://mega.nz/a')]), false);
  assert.equal(ok('links', [link('x'.repeat(31), 'https://mega.nz/a')]), false);
  assert.equal(ok('links', [link('MEGA', 'http://mega.nz/a')]), false);
  assert.equal(ok('links', [link('MEGA', `https://${'x'.repeat(293)}`)]), false);
  assert.equal(ok('links', [{ host: 'MEGA' }]), false);
  assert.equal(ok('links', [{ host: 'MEGA', url: 'https://mega.nz/a', extra: 1 }]), false);
  assert.equal(ok('links', [null]), false);
  assert.equal(ok('links', null), false);
  assert.equal(ok('links', { host: 'MEGA', url: 'https://mega.nz/a' }), false);
});

test('rejects unknown fields, bad ids and bad times', () => {
  assert.equal(ok('bookmarks', []), false);
  assert.equal(ok('__proto__', 1), false);
  assert.equal(checkChange({ id: 0, field: 'rating', v: 1, at: 1 }).ok, false);
  assert.equal(checkChange({ id: 1.5, field: 'rating', v: 1, at: 1 }).ok, false);
  assert.equal(checkChange({ id: '1', field: 'rating', v: 1, at: 1 }).ok, false);
  assert.equal(checkChange({ id: 1, field: 'rating', v: 1, at: -1 }).ok, false);
  assert.equal(checkChange({ id: 1, field: 'rating', at: 1 }).ok, false);
  assert.equal(checkChange(null).ok, false);
  assert.equal(checkChange([1]).ok, false);
});

test('names the field in the rejection reason', () => {
  const result = checkChange({ id: 1, field: 'title', v: 'x'.repeat(201), at: 1 });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /^title: /);
});
