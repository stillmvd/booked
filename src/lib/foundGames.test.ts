import test from "node:test";
import assert from "node:assert/strict";

import { foundGamesPage, matchGames, stripWheel } from "./foundGames.ts";

const games = [
  { id: 1, title: "A House In The Rift" },
  { id: 2, title: "House of Shinobi" },
  { id: 3, title: "Unmasking Julia" },
  { id: 4, title: "Лесная избушка" },
];

test("matches games by title substring ignoring case and spaces around", () => {
  assert.deepEqual(matchGames(games, "  HOUSE ").map((g) => g.id), [1, 2]);
  assert.deepEqual(matchGames(games, "ИЗБ").map((g) => g.id), [4]);
  assert.deepEqual(matchGames(games, "   "), []);
  assert.deepEqual(matchGames(games, "rogue"), []);
});

test("shows first five and counts the rest", () => {
  const hits = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(foundGamesPage(hits), { shown: [1, 2, 3, 4, 5], extra: 3 });
  assert.deepEqual(foundGamesPage([1, 2]), { shown: [1, 2], extra: 0 });
  assert.deepEqual(foundGamesPage([]), { shown: [], extra: 0 });
});

test("vertical wheel scrolls the strip sideways until its edges", () => {
  assert.equal(stripWheel(0, 1000, 600, 0, 100), 100);
  assert.equal(stripWheel(350, 1000, 600, 0, 100), 400);
  assert.equal(stripWheel(400, 1000, 600, 0, 100), null);
  assert.equal(stripWheel(0, 1000, 600, 0, -100), null);
  assert.equal(stripWheel(50, 1000, 600, 0, -100), 0);
});

test("wheel passes through when strip fits or gesture is horizontal", () => {
  assert.equal(stripWheel(0, 600, 600, 0, 100), null);
  assert.equal(stripWheel(0, 1000, 600, 80, 40), null);
  assert.equal(stripWheel(0, 1000, 600, 0, 0), null);
});
