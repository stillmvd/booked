import test from "node:test";
import assert from "node:assert/strict";

import { bookmarkCount, fileNameOf, folderCount, importedText, RESTORE_MODES, tileNote } from "./restore.ts";

test("counts take the right russian form", () => {
  assert.equal(folderCount(1), "1 папка");
  assert.equal(folderCount(12), "12 папок");
  assert.equal(folderCount(22), "22 папки");
  assert.equal(bookmarkCount(214), "214 закладок");
  assert.equal(bookmarkCount(201), "201 закладка");
  assert.equal(bookmarkCount(0), "0 закладок");
});

test("tile note puts the bookmark word before folders", () => {
  assert.equal(tileNote(214, 12), "закладок · 12 папок");
  assert.equal(tileNote(1, 1), "закладка · 1 папка");
  assert.equal(tileNote(3, 0), "закладки · 0 папок");
});

test("imported text lists folders then bookmarks", () => {
  assert.equal(importedText(12, 214), "Импортировано: 12 папок, 214 закладок");
  assert.equal(importedText(1, 1), "Импортировано: 1 папка, 1 закладка");
});

test("file name comes from windows and posix paths", () => {
  assert.equal(fileNameOf("C:\\Users\\me\\Documents\\booked-backup-2026-09-14.json"), "booked-backup-2026-09-14.json");
  assert.equal(fileNameOf("/home/me/копия.json"), "копия.json");
  assert.equal(fileNameOf("копия.json"), "копия.json");
  assert.equal(fileNameOf("C:\\folder\\"), "folder");
});

test("restore modes start with the safe one, replace is marked risky", () => {
  assert.deepEqual(RESTORE_MODES.map((m) => m.value), ["merge", "replace"]);
  assert.deepEqual(RESTORE_MODES.map((m) => m.risk ?? false), [false, true]);
});
