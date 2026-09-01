import { test } from "node:test";
import assert from "node:assert/strict";

import { computeShifts, staggerDelay } from "./flip.ts";

test("staggerDelay на индексе 0 даёт 0", () => {
  assert.equal(staggerDelay(0, 8, 20), 0);
});

test("staggerDelay на последнем индексе внутри потолка даёт максимум волны", () => {
  assert.equal(staggerDelay(7, 8, 20), 140);
});

test("staggerDelay на индексе, равном потолку, даёт 0, а не значение потолка", () => {
  assert.equal(staggerDelay(8, 8, 20), 0);
});

test("staggerDelay для любого индекса не меньше потолка даёт 0", () => {
  assert.equal(staggerDelay(9, 8, 20), 0);
  assert.equal(staggerDelay(39, 8, 20), 0);
});

test("staggerDelay при нулевом шаге даёт 0 для любого индекса — режим экономии анимаций", () => {
  assert.equal(staggerDelay(0, 8, 0), 0);
  assert.equal(staggerDelay(3, 8, 0), 0);
  assert.equal(staggerDelay(7, 8, 0), 0);
});

test("computeShifts возвращает только элементы, присутствующие в обоих снимках", () => {
  const before = new Map([
    ["a", { top: 0, left: 0 }],
    ["b", { top: 10, left: 10 }],
  ]);
  const after = new Map([
    ["a", { top: 5, left: 5 }],
    ["c", { top: 20, left: 20 }],
  ]);
  const shifts = computeShifts(before, after);
  assert.deepEqual(
    shifts.map((s) => s.id),
    ["a"],
  );
});

test("computeShifts не возвращает элементов, чьи координаты не изменились", () => {
  const before = new Map([["a", { top: 10, left: 10 }]]);
  const after = new Map([["a", { top: 10, left: 10 }]]);
  assert.deepEqual(computeShifts(before, after), []);
});

test("computeShifts возвращает разность прежних и новых координат", () => {
  const before = new Map([["a", { top: 100, left: 50 }]]);
  const after = new Map([["a", { top: 40, left: 80 }]]);
  const [shift] = computeShifts(before, after);
  assert.equal(shift.dy, 60);
  assert.equal(shift.dx, -30);
});

test("computeShifts на пустых снимках возвращает пустой массив", () => {
  assert.deepEqual(computeShifts(new Map(), new Map()), []);
});

test("computeShifts игнорирует элементы, появившиеся только в новом снимке", () => {
  const before = new Map();
  const after = new Map([["a", { top: 0, left: 0 }]]);
  assert.deepEqual(computeShifts(before, after), []);
});
