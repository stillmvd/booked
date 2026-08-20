import { test } from "node:test";
import assert from "node:assert/strict";

import { absoluteRu, relativeRu, shortRu } from "./dates.ts";

test("relativeRu_zero_diff_gives_today", () => {
  const now = 1_700_000_000;
  assert.equal(relativeRu(now, now), "сегодня");
});

test("relativeRu_26_hours_gives_yesterday", () => {
  const now = 1_700_000_000;
  const ts = now - 26 * 3600;
  assert.equal(relativeRu(ts, now), "вчера");
});

test("relativeRu_40_days_gives_month_form", () => {
  const now = 1_700_000_000;
  const ts = now - 40 * 86400;
  assert.match(relativeRu(ts, now), /мес/);
});

test("absoluteRu_gives_ten_char_ddmmyyyy", () => {
  const result = absoluteRu(1_691_740_800);
  assert.equal(result.length, 10);
  assert.match(result, /^\d{2}\.\d{2}\.\d{4}$/);
});

test("all_three_functions_are_deterministic", () => {
  const ts = 1_691_740_800;
  assert.equal(shortRu(ts), shortRu(ts));
  assert.equal(absoluteRu(ts), absoluteRu(ts));
  assert.equal(relativeRu(ts, ts + 100), relativeRu(ts, ts + 100));
});
