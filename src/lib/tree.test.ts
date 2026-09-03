import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTree, firstChildIndex, parentIndex, pathTo, subtreeCount, visibleRows } from "./tree.ts";
import type { FolderNode } from "./types.ts";

function node(id: number, parentId: number | null, name: string, bookmarkCount = 0): FolderNode {
  return { id, parentId, name, bookmarkCount };
}

const sample = [
  node(1, null, "Разработка", 3),
  node(2, null, "Архив", 9),
  node(3, 1, "Rust", 7),
  node(4, 3, "Ядро", 14),
  node(5, 1, "Frontend", 5),
];

test("buildTree_empty_input_gives_empty_tree", () => {
  assert.deepEqual(buildTree([]), []);
});

test("buildTree_sorts_siblings_by_russian_locale_at_every_level", () => {
  const tree = buildTree(sample);
  assert.deepEqual(
    tree.map((n) => n.name),
    ["Архив", "Разработка"],
  );
  const dev = tree[1];
  assert.deepEqual(
    dev.children.map((n) => n.name),
    ["Frontend", "Rust"],
  );
  assert.deepEqual(
    dev.children[1].children.map((n) => n.name),
    ["Ядро"],
  );
});

test("buildTree_drops_cycle_without_hanging", () => {
  const cyclic = [node(1, 2, "А"), node(2, 1, "Б"), node(3, null, "Корень")];
  const tree = buildTree(cyclic);
  assert.deepEqual(
    tree.map((n) => n.id),
    [3],
  );
});

test("buildTree_self_parent_is_dropped", () => {
  assert.deepEqual(buildTree([node(1, 1, "Сама себе")]), []);
});

test("buildTree_orphan_with_missing_parent_is_dropped", () => {
  const tree = buildTree([node(1, null, "Есть"), node(2, 99, "Сирота")]);
  assert.deepEqual(
    tree.map((n) => n.id),
    [1],
  );
});

test("subtreeCount_sums_all_descendants", () => {
  const tree = buildTree(sample);
  const dev = tree.find((n) => n.id === 1)!;
  assert.equal(subtreeCount(dev), 3 + 7 + 14 + 5);
});

test("visibleRows_collapsed_shows_top_level_with_subtree_totals", () => {
  const rows = visibleRows(buildTree(sample), new Set());
  assert.deepEqual(
    rows.map((r) => [r.name, r.level, r.hasChildren, r.expanded, r.bookmarkCount]),
    [
      ["Архив", 1, false, false, 9],
      ["Разработка", 1, true, false, 29],
    ],
  );
});

test("visibleRows_expanded_node_shows_own_count_and_children", () => {
  const rows = visibleRows(buildTree(sample), new Set([1]));
  assert.deepEqual(
    rows.map((r) => [r.name, r.level, r.bookmarkCount]),
    [
      ["Архив", 1, 9],
      ["Разработка", 1, 3],
      ["Frontend", 2, 5],
      ["Rust", 2, 21],
    ],
  );
});

test("visibleRows_expanded_id_of_leaf_is_ignored", () => {
  const rows = visibleRows(buildTree(sample), new Set([2]));
  assert.equal(rows.find((r) => r.id === 2)?.expanded, false);
});

test("visibleRows_expanded_child_under_collapsed_parent_stays_hidden", () => {
  const rows = visibleRows(buildTree(sample), new Set([3]));
  assert.deepEqual(
    rows.map((r) => r.id),
    [2, 1],
  );
});

test("pathTo_returns_ancestor_ids_from_root", () => {
  assert.deepEqual(pathTo(sample, 4), [1, 3]);
  assert.deepEqual(pathTo(sample, 1), []);
});

test("pathTo_unknown_or_cyclic_id_terminates", () => {
  assert.deepEqual(pathTo(sample, 999), []);
  const cyclic = [node(1, 2, "А"), node(2, 1, "Б")];
  assert.deepEqual(pathTo(cyclic, 1), [2]);
});

test("keyboard_indexes_walk_visible_rows", () => {
  const rows = visibleRows(buildTree(sample), new Set([1, 3]));
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids, [2, 1, 5, 3, 4]);

  assert.equal(parentIndex(rows, 4), 3);
  assert.equal(parentIndex(rows, 2), 1);
  assert.equal(parentIndex(rows, 1), -1);

  assert.equal(firstChildIndex(rows, 1), 2);
  assert.equal(firstChildIndex(rows, 3), 4);
  assert.equal(firstChildIndex(rows, 0), -1);
});

test("firstChildIndex_of_collapsed_node_is_none", () => {
  const rows = visibleRows(buildTree(sample), new Set());
  assert.equal(firstChildIndex(rows, 1), -1);
});
