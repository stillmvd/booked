import test from "node:test";
import assert from "node:assert/strict";

import { armAll, arrive, dismiss, frequentGameTags, gameEnded, playedText, visibleAsk } from "./rateOffer.ts";

test("ask waits for return unless Booked is focused", () => {
  const away = arrive([], 7, 1000, false, 5000);
  assert.equal(visibleAsk(away), null);
  assert.equal(visibleAsk(armAll(away))?.ask.id, 7);
  assert.equal(visibleAsk(arrive([], 7, 1000, true, 5000))?.ask.id, 7);
});

test("closing the game arms its ask and remembers the end", () => {
  const queue = gameEnded(arrive([], 7, 1000, false, 5000), 7, 9000);
  assert.deepEqual(visibleAsk(queue)?.ask, { id: 7, startedAt: 1000, endedAt: 9000, armed: true, at: 5000 });
  assert.equal(gameEnded(queue, 7, 12000)[0].endedAt, 9000);
});

test("latest ask shows first with the rest counted", () => {
  let queue = arrive([], 1, 0, true, 100);
  queue = arrive(queue, 2, 0, true, 200);
  queue = arrive(queue, 3, 0, false, 300);
  assert.deepEqual([visibleAsk(queue)?.ask.id, visibleAsk(queue)?.more], [2, 1]);
  queue = dismiss(queue, 2);
  assert.deepEqual([visibleAsk(queue)?.ask.id, visibleAsk(queue)?.more], [1, 0]);
});

test("a new run of the same game replaces its ask", () => {
  const queue = arrive(arrive([], 1, 0, true, 100), 1, 500, false, 900);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].startedAt, 500);
});

test("played time in minutes and hours", () => {
  assert.equal(playedText(40 * 60000), "Сыграно 40 мин");
  assert.equal(playedText(65 * 60000), "Сыграно 1 ч 05 мин");
  assert.equal(playedText(20000), "Сыграно 1 мин");
});

test("frequent tags by count, then alphabet, limited", () => {
  const games = [
    { tags: ["сюжет", "аниме-дрочильня"] },
    { tags: ["аниме-дрочильня"] },
    { tags: ["аниме-дрочильня", "3D"] },
    { tags: ["сюжет"] },
    { tags: [] },
  ];
  assert.deepEqual(frequentGameTags(games), ["аниме-дрочильня", "сюжет", "3D"]);
  assert.deepEqual(frequentGameTags(games, 2), ["аниме-дрочильня", "сюжет"]);
});
