import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createHistory,
  current,
  visit,
  goBack,
  goForward,
  canGoBack,
  canGoForward,
  navDirectionOfMouse,
  navDirectionOfKey,
} from "./history.ts";

test("visit добавляет переход и двигает указатель", () => {
  let h = createHistory<number | null>(null);
  h = visit(h, 1);
  h = visit(h, 2);
  assert.deepEqual(h.entries, [null, 1, 2]);
  assert.equal(current(h), 2);
});

test("повторный visit той же папки не плодит записей", () => {
  let h = visit(createHistory<number | null>(null), 1);
  const same = visit(h, 1);
  assert.equal(same, h);
});

test("goBack и goForward ходят по стеку, у границ остаются на месте", () => {
  let h = visit(visit(createHistory<number | null>(null), 1), 2);
  h = goBack(h);
  assert.equal(current(h), 1);
  h = goBack(h);
  assert.equal(current(h), null);
  assert.equal(canGoBack(h), false);
  assert.equal(goBack(h), h);
  h = goForward(h);
  h = goForward(h);
  assert.equal(current(h), 2);
  assert.equal(canGoForward(h), false);
  assert.equal(goForward(h), h);
});

test("visit после goBack обрезает ветку вперёд, как в браузере", () => {
  let h = visit(visit(createHistory<number | null>(null), 1), 2);
  h = goBack(h);
  h = visit(h, 7);
  assert.deepEqual(h.entries, [null, 1, 7]);
  assert.equal(canGoForward(h), false);
});

test("visit текущей после goBack не трогает стек", () => {
  let h = visit(visit(createHistory<number | null>(null), 1), 2);
  h = goBack(h);
  assert.equal(visit(h, 1), h);
  assert.equal(canGoForward(h), true);
});

test("Mouse4 — назад, Mouse5 — вперёд, остальные кнопки мимо", () => {
  assert.equal(navDirectionOfMouse(3), "back");
  assert.equal(navDirectionOfMouse(4), "forward");
  assert.equal(navDirectionOfMouse(0), null);
  assert.equal(navDirectionOfMouse(1), null);
  assert.equal(navDirectionOfMouse(2), null);
});

test("Alt+стрелки — назад и вперёд, без Alt — ничего", () => {
  assert.equal(navDirectionOfKey("ArrowLeft", true), "back");
  assert.equal(navDirectionOfKey("ArrowRight", true), "forward");
  assert.equal(navDirectionOfKey("ArrowLeft", false), null);
  assert.equal(navDirectionOfKey("ArrowUp", true), null);
});
