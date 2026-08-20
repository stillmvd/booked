import { test } from "node:test";
import assert from "node:assert/strict";

import { thumbState } from "./thumbState.ts";

test("image_without_pending_gives_preview", () => {
  assert.equal(thumbState({ image: "a.jpg" }), "preview");
});

test("image_with_pending_gives_preview", () => {
  assert.equal(thumbState({ image: "a.jpg", previewPending: true }), "preview");
});

test("no_image_with_pending_gives_pending", () => {
  assert.equal(thumbState({ image: null, previewPending: true }), "pending");
});

test("no_image_without_pending_gives_plate", () => {
  assert.equal(thumbState({ image: null }), "plate");
});
