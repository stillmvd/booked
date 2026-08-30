import { test } from "node:test";
import assert from "node:assert/strict";

import { hasMore, narrowingState, SEARCH_PAGE, summaryText } from "./searchSummary.ts";

test("summary_text_only_query_uses_guillemets_and_plural_form", () => {
  assert.equal(summaryText(22, "grid", []), "22 результата · «grid»");
  assert.equal(summaryText(1, "grid", []), "1 результат · «grid»");
});

test("summary_text_single_tag_has_no_quotes", () => {
  assert.equal(summaryText(5, "", ["rust"]), "5 результатов · rust");
});

test("summary_text_two_tags_joined_by_ili", () => {
  assert.equal(summaryText(3, "", ["rust", "sqlite"]), "3 результата · rust или sqlite");
});

test("summary_text_three_or_more_tags_comma_then_ili_before_last", () => {
  assert.equal(
    summaryText(9, "", ["rust", "sqlite", "tauri"]),
    "9 результатов · rust, sqlite или tauri",
  );
});

test("summary_text_query_and_tags_together_use_middle_dots", () => {
  assert.equal(
    summaryText(2, "grid", ["rust", "sqlite"]),
    "2 результата · «grid» · rust или sqlite",
  );
});

test("summary_text_pluralization_covers_zero_one_two_five_eleven_twenty_one", () => {
  assert.equal(summaryText(0, "grid", []), "0 результатов · «grid»");
  assert.equal(summaryText(1, "grid", []), "1 результат · «grid»");
  assert.equal(summaryText(2, "grid", []), "2 результата · «grid»");
  assert.equal(summaryText(5, "grid", []), "5 результатов · «grid»");
  assert.equal(summaryText(11, "grid", []), "11 результатов · «grid»");
  assert.equal(summaryText(21, "grid", []), "21 результат · «grid»");
});

test("narrowing_state_offers_narrow_when_global_scope_has_folder_matches", () => {
  const state = narrowingState({
    scopeFolderId: null,
    currentFolderId: 7,
    currentFolderName: "Design",
    total: 22,
    totalGlobal: 22,
    inCurrentFolder: 5,
  });
  assert.deepEqual(state, { kind: "narrow-offer", count: 5, folderName: "Design" });
});

test("narrowing_state_is_none_at_root", () => {
  const state = narrowingState({
    scopeFolderId: null,
    currentFolderId: null,
    currentFolderName: null,
    total: 22,
    totalGlobal: 22,
    inCurrentFolder: 0,
  });
  assert.deepEqual(state, { kind: "none" });
});

test("narrowing_state_is_none_when_all_matches_already_in_current_folder", () => {
  const state = narrowingState({
    scopeFolderId: null,
    currentFolderId: 7,
    currentFolderName: "Design",
    total: 5,
    totalGlobal: 5,
    inCurrentFolder: 5,
  });
  assert.deepEqual(state, { kind: "none" });
});

test("narrowing_state_escalates_when_narrowed_scope_is_empty_but_global_has_matches", () => {
  const state = narrowingState({
    scopeFolderId: 7,
    currentFolderId: 7,
    currentFolderName: "Design",
    total: 0,
    totalGlobal: 12,
    inCurrentFolder: 0,
  });
  assert.deepEqual(state, { kind: "escalate", outsideCount: 12, folderName: "Design" });
});

test("narrowing_state_is_none_when_narrowed_scope_has_results", () => {
  const state = narrowingState({
    scopeFolderId: 7,
    currentFolderId: 7,
    currentFolderName: "Design",
    total: 3,
    totalGlobal: 12,
    inCurrentFolder: 3,
  });
  assert.deepEqual(state, { kind: "none" });
});

test("narrowing_state_is_none_when_globally_zero", () => {
  const state = narrowingState({
    scopeFolderId: 7,
    currentFolderId: 7,
    currentFolderName: "Design",
    total: 0,
    totalGlobal: 0,
    inCurrentFolder: 0,
  });
  assert.deepEqual(state, { kind: "none" });
});

test("has_more_true_when_shown_is_less_than_total_else_false", () => {
  assert.equal(hasMore(40, SEARCH_PAGE * 3), true);
  assert.equal(hasMore(SEARCH_PAGE, SEARCH_PAGE), false);
  assert.equal(hasMore(SEARCH_PAGE + 1, SEARCH_PAGE), false);
});

test("summary_text_never_leaks_fts_syntax", () => {
  const text = summaryText(3, "\"grid\"* OR sqlite", ["rust*"]);
  assert.ok(!text.includes('"'));
  assert.ok(!text.includes("*"));
});
