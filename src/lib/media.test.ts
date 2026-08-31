import { test } from "node:test";
import assert from "node:assert/strict";

import { avatarRelPath, iconRelPath, mediaSrcOf, previewRelPath, thumbRenderMode } from "./media.ts";

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

test("avatar_rel_path_has_no_fan_out", () => {
  assert.deepEqual(avatarRelPath("ab3f1234.png"), ["avatars", "ab3f1234.png"]);
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

test("media_src_of_apple_touch_origin_uses_icons_dir", () => {
  assert.deepEqual(
    mediaSrcOf({ image: null, previewFile: "cafe1234.png", previewOrigin: "apple-touch" }),
    ["icons", "cafe1234.png"],
  );
});

test("media_src_of_favicon_origin_uses_icons_dir", () => {
  assert.deepEqual(
    mediaSrcOf({ image: null, previewFile: "cafe1234.ico", previewOrigin: "favicon" }),
    ["icons", "cafe1234.ico"],
  );
});

test("media_src_of_og_origin_still_uses_previews_dir", () => {
  assert.deepEqual(
    mediaSrcOf({ image: null, previewFile: "ab3f1234.jpg", previewOrigin: "og" }),
    ["previews", "ab", "ab3f1234.jpg"],
  );
});

test("thumb_render_mode_manual_image_always_gives_preview", () => {
  assert.equal(
    thumbRenderMode({ image: "manual.png", previewFile: "auto.ico", previewOrigin: "apple-touch" }),
    "preview",
  );
});

test("thumb_render_mode_auto_og_rung_gives_preview", () => {
  assert.equal(thumbRenderMode({ image: null, previewFile: "auto.jpg", previewOrigin: "og" }), "preview");
});

test("thumb_render_mode_auto_host_rule_rung_gives_preview", () => {
  assert.equal(thumbRenderMode({ image: null, previewFile: "auto.jpg", previewOrigin: "host-rule" }), "preview");
});

test("thumb_render_mode_apple_touch_rung_gives_icon_large", () => {
  assert.equal(thumbRenderMode({ image: null, previewFile: "auto.png", previewOrigin: "apple-touch" }), "icon-large");
});

test("thumb_render_mode_favicon_rung_gives_icon_small", () => {
  assert.equal(thumbRenderMode({ image: null, previewFile: "auto.ico", previewOrigin: "favicon" }), "icon-small");
});

test("thumb_render_mode_without_any_picture_gives_plate", () => {
  assert.equal(thumbRenderMode({ image: null, previewFile: null, previewOrigin: null }), "plate");
});

test("thumb_render_mode_unknown_rung_with_auto_picture_gives_preview_not_plate", () => {
  assert.equal(thumbRenderMode({ image: null, previewFile: "auto.jpg", previewOrigin: null }), "preview");
});
