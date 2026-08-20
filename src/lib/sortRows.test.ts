import { test } from "node:test";
import assert from "node:assert/strict";

import { sortBookmarks } from "./sortRows.ts";
import type { Bookmark } from "./types.ts";

function bookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: 0,
    folderId: null,
    title: "",
    url: "",
    urlNormalized: "https://example.com",
    description: null,
    image: null,
    sort: 0,
    createdAt: 0,
    tags: [],
    ...overrides,
  };
}

test("sort_by_name_places_yo_between_dom_and_zhizn", () => {
  const rows = [
    bookmark({ id: 1, title: "Жизнь" }),
    bookmark({ id: 2, title: "Дом" }),
    bookmark({ id: 3, title: "Ёлка" }),
  ];

  const sorted = sortBookmarks(rows, "name", "asc").map((b) => b.title);

  assert.deepEqual(sorted, ["Дом", "Ёлка", "Жизнь"]);
});

test("sort_desc_is_exact_mirror_of_asc", () => {
  const rows = [
    bookmark({ id: 1, title: "Дом" }),
    bookmark({ id: 2, title: "Ёлка" }),
    bookmark({ id: 3, title: "Жизнь" }),
  ];

  const asc = sortBookmarks(rows, "name", "asc").map((b) => b.id);
  const desc = sortBookmarks(rows, "name", "desc").map((b) => b.id);

  assert.deepEqual(desc, [...asc].reverse());
});

test("sort_does_not_mutate_original_array", () => {
  const rows = [bookmark({ id: 1, title: "Б" }), bookmark({ id: 2, title: "А" })];
  const original = [...rows];

  sortBookmarks(rows, "name", "asc");

  assert.deepEqual(rows, original);
});

test("sort_by_tag_count_is_stable_for_equal_values", () => {
  const rows = [
    bookmark({ id: 1, tags: ["a"] }),
    bookmark({ id: 2, tags: ["b"] }),
    bookmark({ id: 3, tags: ["a", "b"] }),
    bookmark({ id: 4, tags: ["c"] }),
  ];

  const sorted = sortBookmarks(rows, "tags", "asc").map((b) => b.id);

  assert.deepEqual(sorted, [1, 2, 4, 3]);
});
