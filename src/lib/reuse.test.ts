import { test } from "node:test";
import assert from "node:assert/strict";

import { keepIfSame, reuseById, reuseLibrary } from "./reuse.ts";

const a = { id: 1, title: "Лето", tags: ["ренпи"] };
const b = { id: 2, title: "Зима", tags: [] as string[] };

test("reuse_by_id_returns_previous_array_when_nothing_changed", () => {
  const prev = [a, b];
  const next = [{ ...a, tags: [...a.tags] }, { ...b }];
  assert.equal(reuseById(prev, next), prev);
});

test("reuse_by_id_keeps_unchanged_objects_and_takes_changed_ones", () => {
  const prev = [a, b];
  const changed = { ...b, title: "Весна" };
  const out = reuseById(prev, [{ ...a }, changed]);
  assert.notEqual(out, prev);
  assert.equal(out[0], a);
  assert.equal(out[1], changed);
});

test("reuse_by_id_follows_new_order_and_new_items", () => {
  const prev = [a, b];
  const c = { id: 3, title: "Осень", tags: [] as string[] };
  const out = reuseById(prev, [{ ...b }, { ...a }, c]);
  assert.deepEqual(out, [b, a, c]);
  assert.equal(out[0], b);
  assert.equal(out[1], a);
});

test("reuse_library_returns_previous_when_equal", () => {
  const prev = { root: "D:\\Игры", rootAvailable: true, games: [], versions: [{ ids: [1, 2], reasons: {} }] };
  const next = { root: "D:\\Игры", rootAvailable: true, games: [], versions: [{ ids: [1, 2], reasons: {} }] };
  assert.equal(reuseLibrary(prev as never, next as never), prev);
});

test("reuse_library_takes_new_root_state", () => {
  const prev = { root: "D:\\Игры", rootAvailable: true, games: [], versions: [] };
  const next = { root: "D:\\Игры", rootAvailable: false, games: [], versions: [] };
  const out = reuseLibrary(prev as never, next as never);
  assert.equal(out.rootAvailable, false);
  assert.equal(out.games, prev.games);
});

test("keep_if_same_returns_previous_for_equal_value", () => {
  const prev = [{ name: "игры", count: 3 }];
  assert.equal(keepIfSame(prev, [{ name: "игры", count: 3 }]), prev);
  const next = [{ name: "игры", count: 4 }];
  assert.equal(keepIfSame(prev, next), next);
});
