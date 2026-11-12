import { test } from "node:test";
import assert from "node:assert/strict";

import { finishedLabel, playTime, playTimeFull, wantsRating } from "./gameFields.ts";

test("время в игре на карточке", () => {
  assert.equal(playTime(35 * 60), "35 мин");
  assert.equal(playTime(3600), "1 ч");
  assert.equal(playTime(12 * 3600 + 40 * 60), "12 ч");
  assert.equal(playTime(9 * 3600 + 5 * 60), "9 ч 5 мин");
  assert.equal(playTime(120 * 3600 + 1800), "120 ч");
});

test("время в игре полностью", () => {
  assert.equal(playTimeFull(12 * 3600 + 40 * 60), "12 ч 40 мин");
  assert.equal(playTimeFull(7200), "2 ч");
  assert.equal(playTimeFull(90), "1 мин");
});

test("дата прохождения: год только не текущий", () => {
  const now = new Date(2026, 10, 12).getTime();
  assert.equal(finishedLabel(new Date(2026, 10, 3, 15).getTime(), now), "3 ноября");
  assert.equal(finishedLabel(new Date(2025, 2, 8, 15).getTime(), now), "8 марта 2025");
  assert.equal(finishedLabel(new Date(2026, 4, 1, 15).getTime(), now), "1 мая");
});

test("напоминание об оценке", () => {
  assert.equal(wantsRating({ rating: 0, status: "playing", playSecs: 300 }), true);
  assert.equal(wantsRating({ rating: 0, status: "finished", playSecs: 299 }), false);
  assert.equal(wantsRating({ rating: 3, status: "playing", playSecs: 900 }), false);
  assert.equal(wantsRating({ rating: 0, status: "new", playSecs: 900 }), false);
});
