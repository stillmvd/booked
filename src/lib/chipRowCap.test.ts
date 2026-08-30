import { test } from "node:test";
import assert from "node:assert/strict";

import { visibleChipCount } from "./chipRowCap.ts";

test("all_chips_fit_no_tail_needed", () => {
  const visible = visibleChipCount(170, [50, 50, 50], 10, 30);
  assert.equal(visible, 3);
});

test("chips_overflow_shows_prefix_that_fits_with_tail", () => {
  const visible = visibleChipCount(120, [50, 50, 50], 10, 30);
  assert.ok(visible < 3);
  assert.ok(visible >= 1);
});

test("exact_fit_produces_no_tail", () => {
  const visible = visibleChipCount(170, [50, 50, 50], 10, 30);
  assert.equal(visible, 3);
});

test("one_pixel_over_produces_tail_and_drops_last_chip", () => {
  const exact = visibleChipCount(170, [50, 50, 50], 10, 30);
  const overByOne = visibleChipCount(169, [50, 50, 50], 10, 30);
  assert.notEqual(overByOne, exact);
  assert.equal(overByOne, 2);
});

test("first_chip_wider_than_container_still_shows_at_least_one", () => {
  const visible = visibleChipCount(80, [500, 50, 50], 10, 30);
  assert.ok(visible >= 1);
});

test("empty_width_list_gives_zero_visible_and_no_tail", () => {
  const visible = visibleChipCount(500, [], 6, 30);
  assert.equal(visible, 0);
});

test("zero_container_width_before_measurement_is_never_negative", () => {
  const visible = visibleChipCount(0, [40, 40, 40], 6, 30);
  assert.ok(visible >= 0);
});

test("gaps_between_chips_count_as_n_minus_one", () => {
  const fitsExactlyWithGaps = visibleChipCount(46, [20, 20], 6, 30);
  assert.equal(fitsExactlyWithGaps, 2);
  const oneShort = visibleChipCount(45, [20, 20], 6, 30);
  assert.ok(oneShort < 2);
});

test("selected_chips_are_not_a_parameter_of_the_cap_function", () => {
  assert.equal(visibleChipCount.length, 4);
});
