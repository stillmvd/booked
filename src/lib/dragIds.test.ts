import { test } from "node:test";
import assert from "node:assert/strict";

import { folderDragId, folderIdFromTreeDropId, isFolderDragId, isTreeDropId, treeDropId } from "./dragIds.ts";

test("tree_root_has_fixed_id_and_maps_back_to_null", () => {
  assert.equal(treeDropId(null), "tree-root");
  assert.equal(isTreeDropId("tree-root"), true);
  assert.equal(folderIdFromTreeDropId("tree-root"), null);
});

test("tree_folder_id_round_trips", () => {
  assert.equal(treeDropId(42), "tree-42");
  assert.equal(isTreeDropId("tree-42"), true);
  assert.equal(folderIdFromTreeDropId("tree-42"), 42);
});

test("tree_and_folder_drag_ids_do_not_overlap", () => {
  assert.equal(isTreeDropId(folderDragId(7)), false);
  assert.equal(isFolderDragId(treeDropId(7)), false);
  assert.equal(isTreeDropId(7), false);
  assert.equal(isTreeDropId("band-more"), false);
});
