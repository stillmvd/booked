import { test } from "node:test";
import assert from "node:assert/strict";

import { insertionIndexGrid, insertionIndexVertical, reorderIds } from "./insertion.ts";
import type { Rect } from "./insertion.ts";

function rowsAt(tops: number[], height: number): Rect[] {
  return tops.map((top) => ({ top, height }));
}

function tile(left: number, top: number, width = 100, height = 100): Rect {
  return { top, height, left, width };
}

test("pointer_above_middle_of_first_row_gives_zero", () => {
  const rects = rowsAt([0, 100, 200], 100);
  assert.equal(insertionIndexVertical(rects, 10), 0);
});

test("pointer_below_middle_of_last_row_gives_length", () => {
  const rects = rowsAt([0, 100, 200], 100);
  assert.equal(insertionIndexVertical(rects, 280), 3);
});

test("pointer_exactly_on_middle_of_a_row_counts_as_lower_half", () => {
  const rects = rowsAt([0, 100, 200], 100);
  assert.equal(insertionIndexVertical(rects, 50), 1);
});

test("insertion_index_on_empty_rects_is_null", () => {
  assert.equal(insertionIndexVertical([], 42), null);
});

test("reorder_ids_moves_element_forward_within_bounds", () => {
  assert.deepEqual(reorderIds([10, 20, 30], 0, 2), [20, 10, 30]);
});

test("reorder_ids_moves_element_to_the_end", () => {
  assert.deepEqual(reorderIds([10, 20, 30], 0, 3), [20, 30, 10]);
});

test("reorder_ids_with_unchanged_position_returns_equivalent_array", () => {
  assert.deepEqual(reorderIds([10, 20, 30], 1, 1), [10, 20, 30]);
});

test("grid_pointer_left_of_first_tile_of_first_row_gives_zero", () => {
  const rects = [tile(0, 0), tile(116, 0), tile(232, 0)];
  assert.equal(insertionIndexGrid(rects, 10, 10), 0);
});

test("grid_pointer_right_of_last_tile_gives_length", () => {
  const rects = [tile(0, 0), tile(116, 0), tile(232, 0)];
  assert.equal(insertionIndexGrid(rects, 400, 10), 3);
});

test("grid_row_is_resolved_before_horizontal_comparison", () => {
  const row0 = [tile(0, 0), tile(116, 0), tile(232, 0)];
  const row1 = [tile(0, 116)];
  const rects = [...row0, ...row1];
  assert.equal(insertionIndexGrid(rects, 500, 50), 3);
});

test("grid_insertion_index_on_empty_rects_is_null", () => {
  assert.equal(insertionIndexGrid([], 10, 10), null);
});

test("grid_single_item_gives_zero_left_and_one_right_of_its_middle", () => {
  const rects = [tile(0, 0)];
  assert.equal(insertionIndexGrid(rects, 10, 10), 0);
  assert.equal(insertionIndexGrid(rects, 200, 10), 1);
});
