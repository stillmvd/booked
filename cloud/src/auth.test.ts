import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenMatches } from './auth.ts';

test('accepts only the exact bearer token', () => {
  assert.equal(tokenMatches('Bearer dev', 'dev'), true);
  assert.equal(tokenMatches('Bearer dev2', 'dev'), false);
  assert.equal(tokenMatches('Bearer de', 'dev'), false);
  assert.equal(tokenMatches('dev', 'dev'), false);
  assert.equal(tokenMatches(undefined, 'dev'), false);
  assert.equal(tokenMatches('Bearer ', ''), false);
  assert.equal(tokenMatches('Bearer dev', undefined), false);
});
