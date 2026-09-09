import { test } from "node:test";
import assert from "node:assert/strict";

import { clampPercent, coverOverflow, positionStyle, shiftPercent } from "./coverFrame.ts";

test("высокая картинка обрезается только по вертикали", () => {
  const over = coverOverflow(320, 180, 800, 1200);
  assert.equal(Math.round(over.x), 0);
  assert.ok(over.y > 0);
});

test("широкая картинка обрезается только по горизонтали", () => {
  const over = coverOverflow(320, 180, 2000, 400);
  assert.ok(over.x > 0);
  assert.equal(Math.round(over.y), 0);
});

test("картинка ровно по кадру не обрезается", () => {
  const over = coverOverflow(320, 180, 640, 360);
  assert.deepEqual(
    { x: Math.round(over.x), y: Math.round(over.y) },
    { x: 0, y: 0 },
  );
});

test("нулевые размеры не ломают расчёт", () => {
  assert.deepEqual(coverOverflow(0, 180, 800, 600), { x: 0, y: 0 });
  assert.deepEqual(coverOverflow(320, 180, 0, 0), { x: 0, y: 0 });
});

test("перетаскивание вниз показывает верх картинки", () => {
  assert.equal(shiftPercent(50, 50, 100), 0);
  assert.equal(shiftPercent(50, 25, 100), 25);
});

test("перетаскивание вверх показывает низ картинки", () => {
  assert.equal(shiftPercent(50, -50, 100), 100);
});

test("за края кадра выйти нельзя", () => {
  assert.equal(shiftPercent(50, 500, 100), 0);
  assert.equal(shiftPercent(50, -500, 100), 100);
});

test("без обрезки позиция не меняется", () => {
  assert.equal(shiftPercent(37, 120, 0), 37);
});

test("мусорные числа сводятся к центру", () => {
  assert.equal(clampPercent(Number.NaN), 50);
  assert.equal(shiftPercent(Number.NaN, 10, 100), 50);
  assert.equal(clampPercent(-20), 0);
  assert.equal(clampPercent(380), 100);
});

test("строка позиции пригодна для object-position", () => {
  assert.equal(positionStyle(50, 30), "50% 30%");
  assert.equal(positionStyle(-5, 140), "0% 100%");
});
