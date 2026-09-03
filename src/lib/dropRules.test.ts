import { test } from "node:test";
import assert from "node:assert/strict";

import { isDropAllowed, isTreeDropAllowed } from "./dropRules.ts";
import type { DragItem } from "./dropRules.ts";
import type { FolderNode } from "./types.ts";

const nodes: FolderNode[] = [
  { id: 1, name: "Работа", parentId: null, bookmarkCount: 0 },
  { id: 2, name: "Проекты", parentId: 1, bookmarkCount: 0 },
  { id: 3, name: "Архив", parentId: 2, bookmarkCount: 0 },
  { id: 4, name: "Встречи", parentId: 1, bookmarkCount: 0 },
  { id: 5, name: "Дом", parentId: null, bookmarkCount: 0 },
];

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

test("tree_folder_onto_itself_or_descendant_is_forbidden", () => {
  const active: DragItem = { kind: "folder", id: 2, parentId: 1 };
  assert.equal(isTreeDropAllowed({ active, targetFolderId: 2, nodes }), false);
  assert.equal(isTreeDropAllowed({ active, targetFolderId: 3, nodes }), false);
});

test("tree_folder_into_current_parent_is_a_noop", () => {
  assert.equal(isTreeDropAllowed({ active: { kind: "folder", id: 2, parentId: 1 }, targetFolderId: 1, nodes }), false);
  assert.equal(isTreeDropAllowed({ active: { kind: "folder", id: 5, parentId: null }, targetFolderId: null, nodes }), false);
});

test("tree_folder_into_ancestor_sibling_or_root_is_allowed", () => {
  assert.equal(isTreeDropAllowed({ active: { kind: "folder", id: 3, parentId: 2 }, targetFolderId: 1, nodes }), true);
  const active: DragItem = { kind: "folder", id: 2, parentId: 1 };
  assert.equal(isTreeDropAllowed({ active, targetFolderId: 4, nodes }), true);
  assert.equal(isTreeDropAllowed({ active, targetFolderId: 5, nodes }), true);
  assert.equal(isTreeDropAllowed({ active, targetFolderId: null, nodes }), true);
});

test("tree_bookmark_into_own_folder_is_forbidden_elsewhere_allowed", () => {
  const active: DragItem = { kind: "bookmark", id: 10, parentId: 2 };
  assert.equal(isTreeDropAllowed({ active, targetFolderId: 2, nodes }), false);
  assert.equal(isTreeDropAllowed({ active, targetFolderId: 3, nodes }), true);
  assert.equal(isTreeDropAllowed({ active, targetFolderId: null, nodes }), true);
  assert.equal(isTreeDropAllowed({ active: { kind: "bookmark", id: 11, parentId: null }, targetFolderId: null, nodes }), false);
});
