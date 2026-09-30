import test from "node:test";
import assert from "node:assert/strict";

import { aliveRecent, folderPathNames, matchFolders, pushRecentFolder, sanitizeRecent, splitMatch, tileFolders } from "./recentFolders.ts";

test("folder path names keep slashes inside folder names", () => {
  const refs = [
    { id: 1, parentId: null, name: "Аниме / Манга" },
    { id: 2, parentId: 1, name: "Наруто" },
  ];
  assert.deepEqual(folderPathNames(refs, 2), ["Аниме / Манга", "Наруто"]);
  assert.deepEqual(folderPathNames(refs, null), []);
  assert.deepEqual(folderPathNames(refs, 9), []);
  assert.deepEqual(folderPathNames([{ id: 3, parentId: 3, name: "Петля" }], 3), ["Петля", "Петля"]);
});

test("sanitizes stored recent folders", () => {
  assert.deepEqual(sanitizeRecent([3, null, 3, "x", 0, -2, 1.5, 7]), [3, null, 7]);
  assert.deepEqual(sanitizeRecent("мусор"), []);
  assert.deepEqual(sanitizeRecent(null), []);
});

test("pushes folder to the front without duplicates", () => {
  assert.deepEqual(pushRecentFolder([2, 5, null], 5), [5, 2, null]);
  assert.deepEqual(pushRecentFolder([2, 5, null, 8], 9), [9, 2, 5, null]);
  assert.deepEqual(pushRecentFolder([], null), [null]);
});

test("drops folders that no longer exist, keeps the root", () => {
  assert.deepEqual(aliveRecent([4, null, 6], new Set([6])), [null, 6]);
});

test("folder search ignores case, cyrillic included", () => {
  const refs = [{ name: "Naruto" }, { name: "Яндекс картинки" }, { name: "Universe" }];
  assert.deepEqual(matchFolders(refs, "na"), [{ name: "Naruto" }]);
  assert.deepEqual(matchFolders(refs, "ЯНДЕКС"), [{ name: "Яндекс картинки" }]);
  assert.deepEqual(matchFolders(refs, ""), []);
});

test("splits name around the match for highlight", () => {
  assert.deepEqual(splitMatch("Картинки", "тин"), ["Кар", "тин", "ки"]);
  assert.deepEqual(splitMatch("Naruto", "NA"), ["", "Na", "ruto"]);
  assert.deepEqual(splitMatch("Naruto", "x"), ["Naruto", "", ""]);
});

test("tiles take recent folders first, then the fullest ones", () => {
  const nodes = [
    { id: 1, bookmarkCount: 0 },
    { id: 2, bookmarkCount: 18 },
    { id: 3, bookmarkCount: 3 },
    { id: 4, bookmarkCount: 6 },
    { id: 5, bookmarkCount: 1 },
  ];
  assert.deepEqual(tileFolders([3, null, 9], nodes).map((n) => n.id), [3, 2, 4, 5]);
  assert.deepEqual(tileFolders([5, 1], nodes, 3).map((n) => n.id), [5, 1, 2]);
  assert.deepEqual(tileFolders([], []), []);
});
