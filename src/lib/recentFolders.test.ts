import test from "node:test";
import assert from "node:assert/strict";

import { aliveRecent, folderChips, folderPathNames, pushRecentFolder, sanitizeRecent } from "./recentFolders.ts";

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

test("chips show recent folders and the chosen one first when it is not recent", () => {
  assert.deepEqual(folderChips([2, 5], 5), [2, 5]);
  assert.deepEqual(folderChips([2, 5, null, 8], 11), [11, 2, 5, null]);
  assert.deepEqual(folderChips([], null), [null]);
  assert.deepEqual(folderChips([], 3), [3, null]);
});
