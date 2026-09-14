import { test } from "node:test";
import assert from "node:assert/strict";

import { placeMenu, placePopover } from "./menuPosition.ts";

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

const popSize = { width: 332, height: 320 };

test("placePopover: справа от карточки с зазором и сдвигом вниз", () => {
  const anchor = { left: 100, top: 100, right: 332, bottom: 326 };
  assert.deepEqual(placePopover({ anchor, size: popSize, viewport }), { left: 344, top: 112 });
});

test("placePopover: у правого края — слева от карточки", () => {
  const anchor = { left: 700, top: 100, right: 932, bottom: 326 };
  assert.deepEqual(placePopover({ anchor, size: popSize, viewport }), { left: 356, top: 112 });
});

test("placePopover: у нижнего края поднимается, не вылезая за окно", () => {
  const anchor = { left: 100, top: 700, right: 332, bottom: 926 };
  assert.deepEqual(placePopover({ anchor, size: popSize, viewport }), { left: 344, top: 468 });
});

test("placePopover: строка во всю ширину — под строкой, у низа — над ней", () => {
  const row = { left: 20, top: 200, right: 990, bottom: 272 };
  assert.deepEqual(placePopover({ anchor: row, size: popSize, viewport }), { left: 20, top: 284 });
  const low = { left: 20, top: 600, right: 990, bottom: 672 };
  assert.deepEqual(placePopover({ anchor: low, size: popSize, viewport }), { left: 20, top: 268 });
});

test("placePopover: без якоря — по центру", () => {
  assert.deepEqual(placePopover({ anchor: null, size: popSize, viewport }), { left: 334, top: 240 });
});

test("placePopover: окно меньше окошка — прижато к отступу", () => {
  const tiny = { width: 300, height: 200 };
  assert.deepEqual(placePopover({ anchor: null, size: popSize, viewport: tiny }), { left: 12, top: 12 });
});

test("placePopover: строка, где не влезает ни снизу, ни сверху — к стороне, где места больше", () => {
  const vp = { width: 1100, height: 720 };
  const size = { width: 332, height: 350 };
  const row = { left: 272, top: 306, right: 1066, bottom: 378 };
  assert.deepEqual(placePopover({ anchor: row, size, viewport: vp }), { left: 272, top: 358 });
  const high = { left: 272, top: 400, right: 1066, bottom: 472 };
  assert.deepEqual(placePopover({ anchor: high, size, viewport: vp }), { left: 272, top: 38 });
});
