import { test } from "node:test";
import assert from "node:assert/strict";

import { engineCounts, LIBRARY_ORDERS, matchesRate, nextOrder, sortGames, storedOrder, WISH_ORDERS } from "./gameFilters.ts";

const g = (title: string, rating = 0) => ({ title, rating });
const titles = (items: { title: string }[]) => items.map((i) => i.title);

test("по названию — без регистра, по-русски, числа по значению", () => {
  const items = [g("юность"), g("Ёлка"), g("абв"), g("Глава 10"), g("Глава 2"), g("Яблоко")];
  assert.deepEqual(titles(sortGames(items, { key: "name", flip: false })), ["абв", "Глава 2", "Глава 10", "Ёлка", "юность", "Яблоко"]);
  assert.deepEqual(titles(sortGames(items, { key: "name", flip: true })), ["Яблоко", "юность", "Ёлка", "Глава 10", "Глава 2", "абв"]);
});

test("по оценке — высокие сверху, равные по названию", () => {
  const items = [g("Бета", 4), g("Альфа", 4), g("Ноль", 0), g("Пять", 5)];
  assert.deepEqual(titles(sortGames(items, { key: "rating", flip: false })), ["Пять", "Альфа", "Бета", "Ноль"]);
  assert.deepEqual(titles(sortGames(items, { key: "rating", flip: true })), ["Ноль", "Альфа", "Бета", "Пять"]);
});

test("повторный выбор разворачивает, другой пункт — с первого направления", () => {
  assert.deepEqual(nextOrder({ key: "name", flip: false }, "name"), { key: "name", flip: true });
  assert.deepEqual(nextOrder({ key: "name", flip: true }, "rating"), { key: "rating", flip: false });
});

test("сохранённый порядок и перевод старой группировки", () => {
  assert.deepEqual(storedOrder({ key: "rating", flip: true }, false, "launch", LIBRARY_ORDERS), { key: "rating", flip: true });
  assert.deepEqual(storedOrder(null, true, "launch", LIBRARY_ORDERS), { key: "launch", flip: false });
  assert.deepEqual(storedOrder(null, false, "launch", LIBRARY_ORDERS), { key: "name", flip: false });
  assert.deepEqual(storedOrder({ key: "rating", flip: false }, true, "added", WISH_ORDERS), { key: "added", flip: false });
});

test("оценка: от N и без оценки", () => {
  assert.equal(matchesRate(4, 4), true);
  assert.equal(matchesRate(3, 4), false);
  assert.equal(matchesRate(0, "none"), true);
  assert.equal(matchesRate(2, "none"), false);
  assert.equal(matchesRate(0, null), true);
});

test("движки — по числу игр, выбранный остаётся при нуле", () => {
  const items = [{ engine: "Unity" }, { engine: "Ren'Py" }, { engine: "Ren'Py" }, { engine: null }];
  assert.deepEqual(engineCounts(items, null), [["Ren'Py", 2], ["Unity", 1]]);
  assert.deepEqual(engineCounts(items, "HTML"), [["Ren'Py", 2], ["Unity", 1], ["HTML", 0]]);
});
