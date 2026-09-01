import { test } from "node:test";
import assert from "node:assert/strict";

import { placeMenu } from "./menuPosition.ts";

const viewport = { width: 1000, height: 800 };
const size = { width: 240, height: 300 };

test("placeMenu: достаточно места — вправо-вниз от точки, левая и верхняя граница совпадают с якорем", () => {
  const anchor = { left: 100, top: 100, right: 100, bottom: 100 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "point" });
  assert.equal(pos.left, 100);
  assert.equal(pos.top, 100);
});

test("placeMenu: нехватка места справа — переворот влево, правая граница меню совпадает с левой границей якоря", () => {
  const anchor = { left: 900, top: 100, right: 900, bottom: 100 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "point" });
  assert.equal(pos.left, anchor.left - size.width);
});

test("placeMenu: нехватка места снизу — переворот вверх, нижняя граница меню совпадает с якорем", () => {
  const anchor = { left: 100, top: 700, right: 100, bottom: 700 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "point" });
  assert.equal(pos.top, anchor.top - size.height);
});

test("placeMenu: нехватка места с обеих сторон — переворот и по горизонтали, и по вертикали одновременно", () => {
  const anchor = { left: 900, top: 700, right: 900, bottom: 700 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "point" });
  assert.equal(pos.left, anchor.left - size.width);
  assert.equal(pos.top, anchor.top - size.height);
});

test("placeMenu: меню шире вьюпорта — прижато к левому краю, координата не отрицательна", () => {
  const anchor = { left: 900, top: 100, right: 900, bottom: 100 };
  const pos = placeMenu({ anchor, size: { width: 1200, height: 100 }, viewport, prefer: "point" });
  assert.equal(pos.left, 0);
});

test("placeMenu: меню выше вьюпорта — прижато к верхнему краю, координата не отрицательна", () => {
  const anchor = { left: 100, top: 700, right: 100, bottom: 700 };
  const pos = placeMenu({ anchor, size: { width: 100, height: 900 }, viewport, prefer: "point" });
  assert.equal(pos.top, 0);
});

test("placeMenu: режим «сторона» — левая граница меню совпадает с правой границей якоря (родительский пункт)", () => {
  const anchor = { left: 100, top: 100, right: 224, bottom: 132 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "side" });
  assert.equal(pos.left, anchor.right);
});

test("placeMenu: режим «сторона» у правого края — переворот влево, правая граница меню совпадает с левой границей якоря", () => {
  const anchor = { left: 850, top: 100, right: 970, bottom: 132 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "side" });
  assert.equal(pos.left, anchor.left - size.width);
});

test("placeMenu: граница — места ровно столько, сколько нужно, переворота не происходит", () => {
  const anchor = { left: 760, top: 100, right: 760, bottom: 100 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "point" });
  assert.equal(pos.left, 760);
  assert.equal(anchor.left + size.width, viewport.width);
});

test("placeMenu: граница по вертикали — места ровно столько, сколько нужно, переворота не происходит", () => {
  const anchor = { left: 100, top: 500, right: 100, bottom: 500 };
  const pos = placeMenu({ anchor, size, viewport, prefer: "point" });
  assert.equal(pos.top, 500);
  assert.equal(anchor.top + size.height, viewport.height);
});

test("placeMenu: отрицательных координат не возвращает никогда даже при переворотах", () => {
  const anchor = { left: 10, top: 10, right: 10, bottom: 10 };
  const pos = placeMenu({ anchor, size: { width: 240, height: 300 }, viewport, prefer: "point" });
  assert.ok(pos.left >= 0);
  assert.ok(pos.top >= 0);
});
