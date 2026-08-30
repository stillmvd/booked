import { test } from "node:test";
import assert from "node:assert/strict";

import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN, splitHighlighted } from "./highlight.ts";

function wrap(text: string): string {
  return `${HIGHLIGHT_OPEN}${text}${HIGHLIGHT_CLOSE}`;
}

test("plain_string_without_markers_gives_one_segment", () => {
  const segments = splitHighlighted("обычный заголовок");
  assert.deepEqual(segments, [{ text: "обычный заголовок", highlighted: false }]);
});

test("one_wrapped_fragment_gives_three_segments_middle_highlighted", () => {
  const segments = splitHighlighted(`abc${wrap("def")}ghi`);
  assert.deepEqual(segments, [
    { text: "abc", highlighted: false },
    { text: "def", highlighted: true },
    { text: "ghi", highlighted: false },
  ]);
});

test("multiple_wrapped_fragments_alternate_segments", () => {
  const segments = splitHighlighted(`a${wrap("b")}c${wrap("d")}e`);
  assert.deepEqual(segments, [
    { text: "a", highlighted: false },
    { text: "b", highlighted: true },
    { text: "c", highlighted: false },
    { text: "d", highlighted: true },
    { text: "e", highlighted: false },
  ]);
});

test("wrapped_fragment_at_start_has_no_empty_leading_segment", () => {
  const segments = splitHighlighted(`${wrap("def")}ghi`);
  assert.deepEqual(segments, [
    { text: "def", highlighted: true },
    { text: "ghi", highlighted: false },
  ]);
});

test("wrapped_fragment_at_end_has_no_empty_trailing_segment", () => {
  const segments = splitHighlighted(`abc${wrap("def")}`);
  assert.deepEqual(segments, [
    { text: "abc", highlighted: false },
    { text: "def", highlighted: true },
  ]);
});

test("empty_string_gives_empty_segment_list", () => {
  assert.deepEqual(splitHighlighted(""), []);
});

test("unpaired_open_marker_does_not_throw_and_tail_is_plain", () => {
  const input = `abc${HIGHLIGHT_OPEN}def`;
  const segments = splitHighlighted(input);
  assert.ok(segments.every((s) => !s.highlighted));
  assert.equal(segments.map((s) => s.text).join(""), "abcdef");
});

test("no_character_is_lost_besides_the_markers_themselves", () => {
  const input = `${wrap("Гриды")} в вёрстке, ${wrap("SQLite")} и rust`;
  const segments = splitHighlighted(input);
  const rebuilt = segments.map((s) => s.text).join("");
  const stripped = input.split(HIGHLIGHT_OPEN).join("").split(HIGHLIGHT_CLOSE).join("");
  assert.equal(rebuilt, stripped);
});
