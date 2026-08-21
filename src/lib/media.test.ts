import { test } from "node:test";
import assert from "node:assert/strict";

import { iconRelPath, mediaSrcOf, previewRelPath } from "./media.ts";

test("preview_rel_path_fans_out_by_first_two_chars", () => {
  assert.deepEqual(previewRelPath("ab3f1234567890abcdef.jpg"), [
    "previews",
    "ab",
    "ab3f1234567890abcdef.jpg",
  ]);
});

test("icon_rel_path_has_no_fan_out", () => {
  assert.deepEqual(iconRelPath("cafe1234.ico"), ["icons", "cafe1234.ico"]);
});

test("media_src_of_manual_image_only_uses_images_dir", () => {
  assert.deepEqual(mediaSrcOf({ image: "manual.png", previewFile: null }), [
    "images",
    "manual.png",
  ]);
});

test("media_src_of_preview_only_uses_previews_dir", () => {
  assert.deepEqual(mediaSrcOf({ image: null, previewFile: "ab3f1234.jpg" }), [
    "previews",
    "ab",
    "ab3f1234.jpg",
  ]);
});

test("media_src_of_manual_wins_over_preview", () => {
  assert.deepEqual(
    mediaSrcOf({ image: "manual.png", previewFile: "ab3f1234.jpg" }),
    ["images", "manual.png"],
  );
});

test("media_src_of_neither_returns_null", () => {
  assert.equal(mediaSrcOf({ image: null, previewFile: null }), null);
});

test("preview_rel_path_preserves_case_and_full_filename_length", () => {
  const path = previewRelPath("AB3f1234567890abcdef1234567890ab.jpg");
  assert.equal(path[1], "AB");
  assert.equal(path[2], "AB3f1234567890abcdef1234567890ab.jpg");
  assert.equal(path[2].length, "AB3f1234567890abcdef1234567890ab.jpg".length);
});
