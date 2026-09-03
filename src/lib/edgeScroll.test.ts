import { test } from "node:test";
import assert from "node:assert/strict";

import { EDGE_STEP_PX, edgeScrollStep } from "./edgeScroll.ts";

test("outside_the_panel_does_not_scroll", () => {
  assert.equal(edgeScrollStep(50, 100, 400), 0);
  assert.equal(edgeScrollStep(450, 100, 400), 0);
});

test("middle_of_the_panel_does_not_scroll", () => {
  assert.equal(edgeScrollStep(250, 100, 400), 0);
  assert.equal(edgeScrollStep(120, 100, 400), 0);
  assert.equal(edgeScrollStep(380, 100, 400), 0);
});

test("top_and_bottom_edges_scroll_toward_the_edge", () => {
  assert.equal(edgeScrollStep(110, 100, 400), -EDGE_STEP_PX);
  assert.equal(edgeScrollStep(395, 100, 400), EDGE_STEP_PX);
});
