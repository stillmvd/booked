import { test } from "node:test";
import assert from "node:assert/strict";

import { pluralizeRu } from "./pluralizeRu.ts";

const forms: [string, string, string] = ["закладка", "закладки", "закладок"];

test("pluralizeRu picks the correct Russian plural form", () => {
  assert.equal(pluralizeRu(1, forms), "закладка");
  assert.equal(pluralizeRu(2, forms), "закладки");
  assert.equal(pluralizeRu(5, forms), "закладок");
  assert.equal(pluralizeRu(11, forms), "закладок");
  assert.equal(pluralizeRu(21, forms), "закладка");
  assert.equal(pluralizeRu(112, forms), "закладок");
});
