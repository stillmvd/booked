import { test } from "node:test";
import assert from "node:assert/strict";

import { isDropAllowed } from "./dropRules.ts";
import type { DragItem } from "./dropRules.ts";

test("folder_onto_itself_is_forbidden", () => {
  const active: DragItem = { kind: "folder", id: 5, parentId: 1 };
  assert.equal(isDropAllowed({ active, targetFolderId: 5, ancestorIds: [1] }), false);
});

test("bookmark_into_its_own_folder_is_forbidden", () => {
  const active: DragItem = { kind: "bookmark", id: 10, parentId: 3 };
  assert.equal(isDropAllowed({ active, targetFolderId: 3, ancestorIds: [] }), false);
});

test("folder_into_own_ancestor_chain_is_forbidden_for_every_visible_target", () => {
  const active: DragItem = { kind: "folder", id: 2, parentId: 1 };
  assert.equal(isDropAllowed({ active, targetFolderId: 7, ancestorIds: [1, 2] }), false);
  assert.equal(isDropAllowed({ active, targetFolderId: 8, ancestorIds: [1, 2] }), false);
});

test("folder_onto_sibling_is_allowed", () => {
  const active: DragItem = { kind: "folder", id: 2, parentId: 1 };
  assert.equal(isDropAllowed({ active, targetFolderId: 6, ancestorIds: [1] }), true);
});

test("folder_into_root_is_allowed", () => {
  const active: DragItem = { kind: "folder", id: 2, parentId: 1 };
  assert.equal(isDropAllowed({ active, targetFolderId: null, ancestorIds: [1] }), true);
});

test("at_root_with_empty_ancestor_chain_everything_is_allowed_except_self", () => {
  const active: DragItem = { kind: "folder", id: 2, parentId: null };
  assert.equal(isDropAllowed({ active, targetFolderId: 6, ancestorIds: [] }), true);
  assert.equal(isDropAllowed({ active, targetFolderId: null, ancestorIds: [] }), true);
  assert.equal(isDropAllowed({ active, targetFolderId: 2, ancestorIds: [] }), false);
});
