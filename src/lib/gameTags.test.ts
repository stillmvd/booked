import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findTagName,
  hasAllTags,
  matchesNeedle,
  pickerRows,
  tagRows,
  tagsSummary,
  toggleTag,
  visibleTagRows,
  withoutGame,
} from "./gameTags.ts";
import type { TagRow, TaggedGame } from "./gameTags.ts";

const game = (tags: string[], forumTags: string[] = []): TaggedGame => ({ tags, forumTags });

const games = [
  game(["гринд", "sandbox", "Бродилка"], ["sandbox"]),
  game(["гринд", "animated"], ["animated"]),
  game(["sandbox", "на вечер"], ["sandbox"]),
  game(["Бродилка"]),
];

test("tag_rows_count_only_matched_games_and_keep_every_tag", () => {
  const rows = tagRows(games, [games[0], games[1]]);
  assert.deepEqual(
    rows.map((row) => [row.name, row.count]),
    [
      ["гринд", 2],
      ["Бродилка", 1],
      ["animated", 1],
      ["sandbox", 1],
      ["на вечер", 0],
    ],
  );
});

test("tag_rows_mark_forum_source_and_sort_ties_by_russian_name", () => {
  const rows = tagRows(games, games);
  const byName = Object.fromEntries(rows.map((row) => [row.name, row.forum]));
  assert.equal(byName["sandbox"], true);
  assert.equal(byName["гринд"], false);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Бродилка", "гринд", "sandbox", "на вечер", "animated"],
  );
});

test("all_selected_tags_must_be_present", () => {
  assert.equal(hasAllTags(games[0], ["гринд", "sandbox"]), true);
  assert.equal(hasAllTags(games[1], ["гринд", "sandbox"]), false);
  assert.equal(hasAllTags(games[3], []), true);
});

test("counts_after_selection_use_the_narrowed_set", () => {
  const matched = games.filter((g) => hasAllTags(g, ["гринд"]));
  const rows = tagRows(games, matched);
  const count = (name: string) => rows.find((row) => row.name === name)?.count;
  assert.equal(count("гринд"), 2);
  assert.equal(count("sandbox"), 1);
  assert.equal(count("на вечер"), 0);
  assert.equal(rows[rows.length - 1].count, 0);
});

test("toggle_adds_and_removes_in_order", () => {
  assert.deepEqual(toggleTag(["а"], "б"), ["а", "б"]);
  assert.deepEqual(toggleTag(["а", "б"], "а"), ["б"]);
});

test("visible_rows_cut_at_limit_but_keep_selected", () => {
  const rows: TagRow[] = Array.from({ length: 12 }, (_, i) => ({ name: `тег${i}`, count: 12 - i, forum: false }));
  const cut = visibleTagRows(rows, [], false);
  assert.equal(cut.shown.length, 8);
  assert.equal(cut.hidden, 4);
  const withSelected = visibleTagRows(rows, ["тег10"], false);
  assert.equal(withSelected.shown.length, 9);
  assert.equal(withSelected.hidden, 3);
  assert.equal(visibleTagRows(rows, [], true).hidden, 0);
  assert.equal(visibleTagRows(rows.slice(0, 8), [], false).hidden, 0);
});

test("summary_uses_singular_and_plural_forms", () => {
  assert.equal(tagsSummary(["гринд"]), "с тегом «гринд»");
  assert.equal(tagsSummary(["гринд", "На вечер"]), "с тегами «гринд», «На вечер»");
});

test("search_finds_title_or_note_ignoring_case", () => {
  const item = { title: "Лето", note: "Сохранения в папке Saves" };
  assert.equal(matchesNeedle(item, "лет"), true);
  assert.equal(matchesNeedle(item, "saves"), true);
  assert.equal(matchesNeedle(item, "зима"), false);
});

test("picker_puts_checked_first_and_adds_new_names", () => {
  const catalog: TagRow[] = [
    { name: "гринд", count: 7, forum: false },
    { name: "sandbox", count: 41, forum: true },
    { name: "сайд-файтер", count: 4, forum: false },
  ];
  const rows = pickerRows(catalog, ["сайд-файтер", "новый"], ["sandbox"]);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["sandbox", "сайд-файтер", "новый", "гринд"],
  );
  assert.equal(rows.find((row) => row.name === "новый")?.count, 0);
});

test("own_tags_do_not_count_this_game_twice", () => {
  const rows = withoutGame(
    [
      { name: "гринд", count: 3, forum: false },
      { name: "rpg", count: 1, forum: false },
    ],
    ["гринд"],
  );
  assert.deepEqual(
    rows.map((row) => row.count),
    [2, 1],
  );
});

test("exact_name_lookup_ignores_case_and_edges", () => {
  const rows: TagRow[] = [{ name: "На вечер", count: 1, forum: false }];
  assert.equal(findTagName(rows, "  на ВЕЧЕР "), "На вечер");
  assert.equal(findTagName(rows, "вечер"), null);
  assert.equal(findTagName(rows, "  "), null);
});
