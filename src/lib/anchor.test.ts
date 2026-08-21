import { test } from "node:test";
import assert from "node:assert/strict";

import { pickAnchor, nextIndex } from "./anchor.ts";

test("pickAnchor берёт первый элемент, чей верх не выше верха контейнера", () => {
  const items = [
    { id: "a", top: -40 },
    { id: "b", top: 12 },
    { id: "c", top: 88 },
  ];
  assert.equal(pickAnchor(items, 0)?.id, "b");
});

test("pickAnchor возвращает дельту со знаком, а не абсолютное значение", () => {
  assert.equal(pickAnchor([{ id: "a", top: 15 }], 0)?.delta, 15);
  assert.equal(pickAnchor([{ id: "a", top: -0.5 }], 0)?.delta, -0.5);
});

test("pickAnchor на пустом списке даёт null", () => {
  assert.equal(pickAnchor([], 0), null);
});

test("pickAnchor терпит дробные значения в пределах допуска", () => {
  const items = [{ id: "a", top: 99.4 }];
  assert.equal(pickAnchor(items, 100)?.id, "a");
});

test("pickAnchor на списке, где все элементы выше верха контейнера, возвращает null", () => {
  const items = [
    { id: "a", top: -100 },
    { id: "b", top: -50 },
  ];
  assert.equal(pickAnchor(items, 0), null);
});

test("nextIndex в сетке из четырёх колонок: стрелка вниз с индекса 2 даёт 6", () => {
  assert.equal(nextIndex("ArrowDown", 2, 10, 4, 4), 6);
});

test("nextIndex в сетке из четырёх колонок: стрелка вверх с индекса 2 даёт null", () => {
  assert.equal(nextIndex("ArrowUp", 2, 10, 4, 4), null);
});

test("nextIndex в одной колонке стрелка вниз даёт следующий индекс", () => {
  assert.equal(nextIndex("ArrowDown", 3, 10, 1, 1), 4);
});

test("nextIndex End даёт последний индекс при любом числе колонок", () => {
  assert.equal(nextIndex("End", 0, 10, 4, 4), 9);
  assert.equal(nextIndex("End", 0, 10, 1, 1), 9);
});

test("nextIndex Home даёт нулевой индекс", () => {
  assert.equal(nextIndex("Home", 7, 10, 4, 4), 0);
});

test("nextIndex PageDown у предпоследнего экрана зажимается в последний индекс", () => {
  assert.equal(nextIndex("PageDown", 8, 10, 1, 5), 9);
});

test("nextIndex PageDown возвращает индекс в пределах массива даже когда шаг больше остатка", () => {
  assert.equal(nextIndex("PageDown", 8, 10, 1, 100), 9);
});

test("nextIndex PageUp зажимается в нулевой индекс", () => {
  assert.equal(nextIndex("PageUp", 2, 10, 1, 100), 0);
});

test("nextIndex неизвестная клавиша даёт null", () => {
  assert.equal(nextIndex("Escape", 2, 10, 4, 4), null);
});

test("nextIndex на пустом списке даёт null", () => {
  assert.equal(nextIndex("ArrowRight", 0, 0, 4, 4), null);
});

test("nextIndex ArrowRight за последним элементом даёт null", () => {
  assert.equal(nextIndex("ArrowRight", 9, 10, 4, 4), null);
});
