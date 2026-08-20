import { test } from "node:test";
import assert from "node:assert/strict";

import { visibleFolderCount } from "./bandCap.ts";

test("при ширине 800 и сорока папках видно восемь", () => {
  assert.equal(visibleFolderCount(800, 40), 8);
});

test("при ширине 800 и пяти папках видно пять — кап не может показать меньше, чем есть", () => {
  assert.equal(visibleFolderCount(800, 5), 5);
});

test("при нулевой ширине результат не меньше двух и не отрицателен", () => {
  const visible = visibleFolderCount(0, 40);
  assert.ok(visible >= 2);
  assert.ok(visible >= 0);
});

test("при ширине 1500 и сорока папках видно шестнадцать", () => {
  assert.equal(visibleFolderCount(1500, 40), 16);
});
