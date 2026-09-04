import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY, counts, rangeTo, selectAll, splitIds, summaryText, toggle } from "./selection.ts";

test("toggle добавляет элемент и делает его якорем", () => {
  const next = toggle(EMPTY, "b1");
  assert.deepEqual(next.ids, new Set(["b1"]));
  assert.equal(next.anchor, "b1");
});

test("toggle повторно убирает элемент, но якорь остаётся на нём", () => {
  const added = toggle(EMPTY, "b1");
  const removed = toggle(added, "b1");
  assert.deepEqual(removed.ids, new Set());
  assert.equal(removed.anchor, "b1");
});

test("rangeTo выделяет диапазон от якоря вперёд по визуальному порядку", () => {
  const ordered = ["f1", "b1", "b2", "b3", "b4"];
  const anchored = toggle(EMPTY, "b1");
  const next = rangeTo(anchored, "b3", ordered);
  assert.deepEqual(next.ids, new Set(["b1", "b2", "b3"]));
  assert.equal(next.anchor, "b1");
});

test("rangeTo выделяет диапазон от якоря назад по визуальному порядку", () => {
  const ordered = ["f1", "b1", "b2", "b3", "b4"];
  const anchored = toggle(EMPTY, "b3");
  const next = rangeTo(anchored, "f1", ordered);
  assert.deepEqual(next.ids, new Set(["f1", "b1", "b2", "b3"]));
  assert.equal(next.anchor, "b3");
});

test("rangeTo без якоря выделяет только нажатый элемент и ставит на него якорь", () => {
  const next = rangeTo(EMPTY, "b2", ["b1", "b2", "b3"]);
  assert.deepEqual(next.ids, new Set(["b2"]));
  assert.equal(next.anchor, "b2");
});

test("selectAll выделяет все переданные id и ставит якорь на первый", () => {
  const next = selectAll(["f1", "b1", "b2"]);
  assert.deepEqual(next.ids, new Set(["f1", "b1", "b2"]));
  assert.equal(next.anchor, "f1");
});

test("counts считает закладки и папки раздельно", () => {
  assert.deepEqual(counts(new Set(["b1", "b2", "f1"])), { bookmarks: 2, folders: 1 });
});

test("splitIds разбирает составные id на числовые массивы", () => {
  assert.deepEqual(splitIds(new Set(["b10", "f20", "b30"])), { bookmarkIds: [10, 30], folderIds: [20] });
});

test("summaryText: смешанный выбор использует безличную форму «Выбрано»", () => {
  assert.equal(summaryText(new Set(["b1", "b2", "b3", "f1"])), "Выбрано 3 закладки и 1 папка");
});

test("summaryText: одна папка согласуется по роду («Выбрана»)", () => {
  assert.equal(summaryText(new Set(["f1"])), "Выбрана 1 папка");
});

test("summaryText: одна закладка согласуется по роду («Выбрана»)", () => {
  assert.equal(summaryText(new Set(["b1"])), "Выбрана 1 закладка");
});

test("summaryText: несколько папок используют безличную форму множественного числа", () => {
  assert.equal(summaryText(new Set(["f1", "f2", "f3", "f4", "f5"])), "Выбрано 5 папок");
});
