import test from "node:test";
import assert from "node:assert/strict";

import { choiceByKey } from "./choiceKeys.ts";
import { contentsChips, folderDeleteModes } from "./folderDelete.ts";

test("chips list only what the folder holds", () => {
  assert.deepEqual(contentsChips({ bookmarks: 24, folders: 3 }), ["24 закладки", "3 подпапки"]);
  assert.deepEqual(contentsChips({ bookmarks: 0, folders: 1 }), ["1 подпапка"]);
  assert.deepEqual(contentsChips({ bookmarks: 11, folders: 0 }), ["11 закладок"]);
  assert.deepEqual(contentsChips({ bookmarks: 0, folders: 0 }), []);
});

test("delete modes name the parent and agree the verb with the count", () => {
  const [promote, all] = folderDeleteModes({ bookmarks: 24, folders: 3 }, "Authors");
  assert.equal(promote.value, "promote");
  assert.equal(promote.title, "Перенести в «Authors»");
  assert.equal(promote.description, "Содержимое переедет, исчезнет только сама папка");
  assert.equal(all.value, "all");
  assert.equal(all.risk, true);
  assert.equal(all.description, "24 закладки и 3 подпапки удалятся вместе с папкой");

  assert.equal(folderDeleteModes({ bookmarks: 21, folders: 0 }, null)[0].title, "Перенести в «Booked»");
  assert.equal(folderDeleteModes({ bookmarks: 21, folders: 0 }, null)[1].description, "21 закладка удалится вместе с папкой");
  assert.equal(folderDeleteModes({ bookmarks: 0, folders: 1 }, null)[1].description, "1 подпапка удалится вместе с папкой");
  assert.equal(folderDeleteModes({ bookmarks: 0, folders: 12 }, null)[1].description, "12 подпапок удалятся вместе с папкой");
});

test("arrow keys cycle choices, other keys do nothing", () => {
  const values = ["promote", "all"];
  assert.equal(choiceByKey(values, "promote", "ArrowDown"), "all");
  assert.equal(choiceByKey(values, "all", "ArrowDown"), "promote");
  assert.equal(choiceByKey(values, "promote", "ArrowUp"), "all");
  assert.equal(choiceByKey(values, "all", "ArrowLeft"), "promote");
  assert.equal(choiceByKey(values, "promote", "ArrowRight"), "all");
  assert.equal(choiceByKey(values, "all", "Home"), "promote");
  assert.equal(choiceByKey(values, "promote", "End"), "all");
  assert.equal(choiceByKey(values, "promote", "Enter"), null);
  assert.equal(choiceByKey(values, "promote", " "), null);
});
