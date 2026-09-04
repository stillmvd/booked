import { test } from "node:test";
import assert from "node:assert/strict";

import { ancestorPath, buildMoveTargets, filterTargets, isDescendantOrSelf, normalizeQuery } from "./folderTree.ts";
import type { FolderRef } from "./types.ts";

function folder(id: number, parentId: number | null, name: string): FolderRef {
  return { id, parentId, name };
}

test("ancestorPath_root_folder_returns_empty", () => {
  const folders = [folder(1, null, "Работа")];
  assert.deepEqual(ancestorPath(folders, 1), []);
});

test("ancestorPath_third_level_returns_two_ancestors_top_down", () => {
  const folders = [folder(1, null, "Работа"), folder(2, 1, "Проекты"), folder(3, 2, "Дизайн")];
  assert.deepEqual(ancestorPath(folders, 3), ["Работа", "Проекты"]);
});

test("ancestorPath_broken_parent_reference_stops_instead_of_looping", () => {
  const folders = [folder(1, 99, "Сирота")];
  assert.deepEqual(ancestorPath(folders, 1), []);
});

test("buildMoveTargets_depth_first_children_sorted_by_name", () => {
  const folders = [folder(1, null, "Б"), folder(2, null, "А"), folder(3, 1, "Вложенная")];
  const targets = buildMoveTargets(folders, { kind: "bookmark", id: 100, folderId: null });
  assert.deepEqual(
    targets.map((t) => t.id),
    [2, 1, 3],
  );
});

test("buildMoveTargets_order_independent_of_input_order", () => {
  const ordered = [folder(1, null, "А"), folder(2, null, "Б"), folder(3, 1, "В")];
  const shuffled = [folder(3, 1, "В"), folder(2, null, "Б"), folder(1, null, "А")];
  const active = { kind: "bookmark" as const, id: 100, folderId: null };
  assert.deepEqual(buildMoveTargets(ordered, active), buildMoveTargets(shuffled, active));
});

test("buildMoveTargets_folder_move_excludes_self_and_whole_subtree_depth_three", () => {
  const folders = [
    folder(1, null, "Работа"),
    folder(2, 1, "Проекты"),
    folder(3, 2, "Архив"),
    folder(4, 3, "Старое"),
    folder(5, 4, "2020"),
    folder(6, null, "Личное"),
  ];
  const targets = buildMoveTargets(folders, { kind: "folder", id: 2, folderId: 1 });
  const ids = targets.map((t) => t.id);
  assert.ok(!ids.includes(2));
  assert.ok(!ids.includes(3));
  assert.ok(!ids.includes(4));
  assert.ok(!ids.includes(5));
  assert.ok(ids.includes(6));
});

test("buildMoveTargets_folder_move_keeps_parent_and_siblings", () => {
  const folders = [folder(1, null, "Работа"), folder(2, 1, "Проекты"), folder(3, 1, "Личное")];
  const targets = buildMoveTargets(folders, { kind: "folder", id: 2, folderId: 1 });
  const ids = targets.map((t) => t.id);
  assert.ok(ids.includes(1));
  assert.ok(ids.includes(3));
});

test("buildMoveTargets_bookmark_move_excludes_only_containing_folder", () => {
  const folders = [folder(1, null, "Работа"), folder(2, 1, "Проекты"), folder(3, 2, "Дизайн")];
  const targets = buildMoveTargets(folders, { kind: "bookmark", id: 100, folderId: 2 });
  const ids = targets.map((t) => t.id);
  assert.ok(ids.includes(1));
  assert.ok(!ids.includes(2));
  assert.ok(ids.includes(3));
});

test("isDescendantOrSelf_same_id_is_true", () => {
  const folders = [folder(1, null, "Работа")];
  assert.equal(isDescendantOrSelf(folders, 1, 1), true);
});

test("isDescendantOrSelf_nested_grandchild_is_true", () => {
  const folders = [folder(1, null, "Работа"), folder(2, 1, "Проекты"), folder(3, 2, "Дизайн")];
  assert.equal(isDescendantOrSelf(folders, 3, 1), true);
});

test("isDescendantOrSelf_unrelated_folder_is_false", () => {
  const folders = [folder(1, null, "Работа"), folder(2, null, "Личное")];
  assert.equal(isDescendantOrSelf(folders, 2, 1), false);
});

test("isDescendantOrSelf_root_target_is_false", () => {
  const folders = [folder(1, null, "Работа")];
  assert.equal(isDescendantOrSelf(folders, null, 1), false);
});

test("buildMoveTargets_two_folders_same_name_different_levels_stay_distinct", () => {
  const folders = [folder(1, null, "Работа"), folder(2, 1, "Работа")];
  const targets = buildMoveTargets(folders, { kind: "bookmark", id: 100, folderId: null });
  assert.equal(targets.length, 2);
  assert.deepEqual(targets[0].path, []);
  assert.deepEqual(targets[1].path, ["Работа"]);
});

test("normalizeQuery_collapses_cyrillic_case", () => {
  assert.equal(normalizeQuery("Дизайн"), normalizeQuery("дизайн"));
});

test("normalizeQuery_folds_diacritics_cyrillic_and_latin", () => {
  assert.equal(normalizeQuery("Ёлка"), normalizeQuery("Елка"));
  assert.equal(normalizeQuery("Café"), normalizeQuery("Cafe"));
});

test("normalizeQuery_trims_surrounding_whitespace", () => {
  assert.equal(normalizeQuery("  Работа  "), normalizeQuery("Работа"));
});

test("filterTargets_empty_query_returns_all_in_original_order", () => {
  const targets = buildMoveTargets([folder(1, null, "Б"), folder(2, null, "А")], {
    kind: "bookmark",
    id: 100,
    folderId: null,
  });
  assert.deepEqual(filterTargets(targets, ""), targets);
});

test("filterTargets_finds_by_substring_case_and_diacritic_insensitive", () => {
  const targets = buildMoveTargets([folder(1, null, "Дизайн"), folder(2, null, "Разработка")], {
    kind: "bookmark",
    id: 100,
    folderId: null,
  });
  const found = filterTargets(targets, "дизайн");
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 1);
});

test("filterTargets_does_not_search_ancestor_path", () => {
  const targets = buildMoveTargets([folder(1, null, "Работа"), folder(2, 1, "Дизайн")], {
    kind: "bookmark",
    id: 100,
    folderId: null,
  });
  const found = filterTargets(targets, "работа");
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 1);
});

test("filterTargets_preserves_depth_first_order_among_equal_matches", () => {
  const folders = [folder(1, null, "Проект Б"), folder(2, null, "Проект А")];
  const targets = buildMoveTargets(folders, { kind: "bookmark", id: 100, folderId: null });
  const found = filterTargets(targets, "проект");
  assert.deepEqual(
    found.map((t) => t.id),
    [2, 1],
  );
});
