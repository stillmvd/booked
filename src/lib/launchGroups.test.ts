import { test } from "node:test";
import assert from "node:assert/strict";

import { daysAgo, launchGroups } from "./launchGroups.ts";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;
const now = new Date(2026, 8, 30, 0, 10);
const game = (id: number, lastLaunchedAt: number | null) => ({ id, lastLaunchedAt });
const shape = (groups: ReturnType<typeof launchGroups<{ id: number; lastLaunchedAt: number | null }>>) =>
  groups.map((g) => [g.label, g.items.map((i) => i.id)]);

test("вчера в 23:50 при 00:10 — это вчера, а не сегодня", () => {
  assert.equal(daysAgo(at(2026, 9, 29, 23, 50), now), 1);
  assert.equal(daysAgo(at(2026, 9, 30, 0, 1), now), 0);
});

test("блоки идут по порядку, пустые не выводятся", () => {
  const groups = launchGroups(
    [
      game(1, null),
      game(2, at(2026, 8, 1)),
      game(3, at(2026, 9, 23)),
      game(4, at(2026, 9, 27)),
      game(5, at(2026, 9, 30, 0, 5)),
      game(6, at(2026, 9, 29, 23, 50)),
    ],
    now,
  );
  assert.deepEqual(shape(groups), [
    ["Сегодня", [5]],
    ["Вчера", [6]],
    ["Воскресенье", [4]],
    ["Больше недели назад", [3]],
    ["Больше месяца назад", [2]],
    ["Не запускал", [1]],
  ]);
});

test("дни со 2-го по 6-й — отдельные блоки с днём недели", () => {
  const groups = launchGroups([game(1, at(2026, 9, 28)), game(2, at(2026, 9, 24)), game(3, at(2026, 9, 26))], now);
  assert.deepEqual(shape(groups), [
    ["Понедельник", [1]],
    ["Суббота", [3]],
    ["Четверг", [2]],
  ]);
});

test("границы: 7 и 30 дней — неделя, 31 — месяц", () => {
  const groups = launchGroups([game(7, at(2026, 9, 23)), game(30, at(2026, 8, 31)), game(31, at(2026, 8, 30))], now);
  assert.deepEqual(shape(groups), [
    ["Больше недели назад", [7, 30]],
    ["Больше месяца назад", [31]],
  ]);
});

test("внутри блока — последняя запущенная первой", () => {
  const groups = launchGroups([game(1, at(2026, 9, 10)), game(2, at(2026, 9, 20)), game(3, at(2026, 9, 15))], now);
  assert.deepEqual(shape(groups), [["Больше недели назад", [2, 3, 1]]]);
});

test("дата из будущего считается сегодняшней", () => {
  assert.deepEqual(shape(launchGroups([game(1, at(2026, 10, 2))], now)), [["Сегодня", [1]]]);
});

test("пустой список — нет блоков", () => {
  assert.deepEqual(launchGroups([], now), []);
});
