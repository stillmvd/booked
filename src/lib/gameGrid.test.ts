import { test } from "node:test";
import assert from "node:assert/strict";

import { gridColumns, openPlacement } from "./gameGrid.ts";

test("columns_follow_auto_fill_with_min_264_and_gap_20", () => {
  assert.equal(gridColumns(200), 1);
  assert.equal(gridColumns(547), 1);
  assert.equal(gridColumns(548), 2);
  assert.equal(gridColumns(832), 3);
  assert.equal(gridColumns(1116), 4);
});

test("single_column_keeps_panel_in_flow", () => {
  assert.deepEqual(openPlacement(3, 1, 8), { card: null, panel: null, spot: null });
});

test("two_columns_put_card_and_panel_side_by_side_in_its_row", () => {
  const placement = openPlacement(3, 2, 8);
  assert.deepEqual(placement.card, { gridRow: 2, gridColumn: "1" });
  assert.deepEqual(placement.panel, { gridRow: 2, gridColumn: "2" });
  assert.equal(placement.spot, null);
});

test("three_columns_widen_card_to_two_without_spot", () => {
  const placement = openPlacement(5, 3, 8);
  assert.deepEqual(placement.card, { gridRow: 2, gridColumn: "1 / span 2" });
  assert.deepEqual(placement.panel, { gridRow: 2, gridColumn: "3" });
  assert.equal(placement.spot, null);
});

test("wide_grid_adds_spot_under_card_and_panel_when_neighbours_exist", () => {
  const placement = openPlacement(6, 5, 12);
  assert.deepEqual(placement.card, { gridRow: 2, gridColumn: "1 / span 2" });
  assert.deepEqual(placement.spot, { gridRow: 2, gridColumn: "1 / span 3" });
});

test("wide_grid_with_a_single_game_has_no_spot", () => {
  assert.equal(openPlacement(0, 4, 1).spot, null);
});

test("closed_card_has_no_placement", () => {
  assert.deepEqual(openPlacement(-1, 4, 6), { card: null, panel: null, spot: null });
});
