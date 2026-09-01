import { test } from "node:test";
import assert from "node:assert/strict";

import { insertionIndexVertical, reorderIds } from "./insertion.ts";
import type { Rect } from "./insertion.ts";

function rowsAt(tops: number[], height: number): Rect[] {
  return tops.map((top) => ({ top, height }));
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
