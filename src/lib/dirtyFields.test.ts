import { test } from "node:test";
import assert from "node:assert/strict";

import { applyFetched, fallbackTitle, isDirty, markDirty } from "./dirtyFields.ts";
import type { DirtySet, FieldValues } from "./dirtyFields.ts";

const EMPTY: DirtySet = new Set();

test("untouched_field_is_filled_with_fetched_value", () => {
  const current: FieldValues = { url: "https://a.test", title: "", image: null };
  const result = applyFetched(current, { title: "Fetched Title" }, EMPTY);
  assert.equal(result.title, "Fetched Title");
});

test("touched_field_keeps_its_value_even_when_fetched_differs", () => {
  const current: FieldValues = { url: "https://a.test", title: "Mine", image: null };
  const dirty = markDirty(EMPTY, "title");
  const result = applyFetched(current, { title: "Fetched Title" }, dirty);
  assert.equal(result.title, "Mine");
});

test("touched_field_cleared_to_empty_stays_empty", () => {
  const current: FieldValues = { url: "https://a.test", title: "", image: null };
  const dirty = markDirty(EMPTY, "title");
  const result = applyFetched(current, { title: "Fetched Title" }, dirty);
  assert.equal(result.title, "");
});

test("untouched_field_not_changed_by_empty_or_missing_fetched_value", () => {
  const current: FieldValues = { url: "https://a.test", title: "Existing", image: null };
  assert.equal(applyFetched(current, { title: "" }, EMPTY).title, "Existing");
  assert.equal(applyFetched(current, {}, EMPTY).title, "Existing");
});

test("marking_dirty_is_idempotent", () => {
  const once = markDirty(EMPTY, "title");
  const twice = markDirty(once, "title");
  assert.equal(twice.size, 1);
  assert.ok(isDirty(twice, "title"));
});

test("marking_one_field_does_not_touch_others", () => {
  const dirty = markDirty(EMPTY, "title");
  assert.ok(!isDirty(dirty, "url"));
  assert.ok(!isDirty(dirty, "image"));
});

test("rule_applies_to_all_fields_in_one_call_without_mutating_input", () => {
  const current: FieldValues = { url: "https://a.test", title: "", image: null };
  const dirty = markDirty(EMPTY, "image");
  const result = applyFetched(current, { title: "Fetched", image: "auto.jpg" }, dirty);
  assert.equal(result.title, "Fetched");
  assert.equal(result.image, null);
  assert.equal(current.title, "");
  assert.equal(current.image, null);
});

test("fallback_title_is_host_plus_first_path_segment", () => {
  assert.equal(fallbackTitle("https://www.example.com/blog/post-1"), "example.com/blog");
});

test("fallback_title_without_path_is_just_host", () => {
  assert.equal(fallbackTitle("https://example.com"), "example.com");
});

test("fallback_title_of_unparseable_url_is_empty_string", () => {
  assert.equal(fallbackTitle("not a url"), "");
});

test("field_names_do_not_include_description", () => {
  const current: FieldValues = { url: "", title: "", image: null };
  const fieldNames = Object.keys(current);
  assert.ok(!fieldNames.includes("description"));
});
