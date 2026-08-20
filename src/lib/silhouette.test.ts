import { test } from "node:test";
import assert from "node:assert/strict";

import { silhouettePath } from "./silhouette.ts";

test("путь начинается с M 7.5 0.5 и заканчивается Z", () => {
  const path = silhouettePath();
  assert.equal(path.startsWith("M 7.5 0.5"), true);
  assert.equal(path.endsWith("Z"), true);
});

test("в пути ровно одна команда C", () => {
  const path = silhouettePath();
  assert.equal((path.match(/C /g) ?? []).length, 1);
});

test("в пути ровно четыре команды Q", () => {
  const path = silhouettePath();
  assert.equal((path.match(/Q /g) ?? []).length, 4);
});

test("silhouettePath() детерминирован — два вызова дают идентичную строку", () => {
  assert.equal(silhouettePath(), silhouettePath());
});
