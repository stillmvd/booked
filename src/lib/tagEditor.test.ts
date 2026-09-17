import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dropSelected,
  filterTags,
  findTag,
  mergeInto,
  mergeText,
  renameSelected,
  sortTags,
  tagsSummary,
  targetWord,
  usageFrom,
  usageText,
} from "./tagEditor.ts";
import type { TagUsage } from "./types.ts";

function tag(name: string, bookmarks = 0, folders = 0, games = 0): TagUsage {
  return { name, bookmarks, folders, games };
}

const TAGS = [tag("шрифты", 11), tag("игры", 20, 0, 3), tag("Дизайн", 14, 2), tag("Rust", 9, 1), tag("новелла"), tag("визуальная новелла")];

test("по частоте: сумма использований по убыванию, при равенстве — по алфавиту без регистра", () => {
  const names = sortTags([...TAGS, tag("архив", 11)], "frequency").map((t) => t.name);
  assert.deepEqual(names, ["игры", "Дизайн", "архив", "шрифты", "Rust", "визуальная новелла", "новелла"]);
  assert.deepEqual(sortTags([tag("Zeta", 1), tag("альфа", 1)], "frequency").map((t) => t.name), ["альфа", "Zeta"]);
});

test("по алфавиту: без учёта регистра, кириллица перед латиницей", () => {
  const names = sortTags(TAGS, "alpha").map((t) => t.name);
  assert.deepEqual(names, ["визуальная новелла", "Дизайн", "игры", "новелла", "шрифты", "Rust"]);
});

test("сортировка не меняет исходный список", () => {
  const before = TAGS.map((t) => t.name);
  sortTags(TAGS, "alpha");
  assert.deepEqual(TAGS.map((t) => t.name), before);
});

test("поиск сужает по вхождению без учёта регистра, пустой запрос оставляет всё", () => {
  assert.deepEqual(filterTags(TAGS, " ДИЗ ").map((t) => t.name), ["Дизайн"]);
  assert.deepEqual(filterTags(TAGS, "новелла").map((t) => t.name), ["новелла", "визуальная новелла"]);
  assert.equal(filterTags(TAGS, "   ").length, TAGS.length);
});

test("точное совпадение имени — без регистра и пробелов по краям", () => {
  assert.equal(findTag(TAGS, "  дизайн ")?.name, "Дизайн");
  assert.equal(findTag(TAGS, "диз"), undefined);
  assert.equal(findTag(TAGS, "  "), undefined);
});

test("слияние — только с другим тегом; смена регистра того же тега не слияние", () => {
  assert.equal(mergeInto(TAGS, "игры", "дизайн")?.name, "Дизайн");
  assert.equal(mergeInto(TAGS, "Дизайн", "ДИЗАЙН"), null);
  assert.equal(mergeInto(TAGS, "игры", "Игры PC"), null);
});

test("счётчики словами: нулевые виды не называются, пустой — «не используется»", () => {
  assert.equal(usageText(tag("игры", 12, 1, 3)), "12 закладок · 1 папка · 3 игры");
  assert.equal(usageText(tag("игры", 0, 0, 21)), "21 игра");
  assert.equal(usageText(tag("игры", 2, 5)), "2 закладки · 5 папок");
  assert.equal(usageText(tag("мусор")), "не используется");
});

test("вопрос удаления в родительном падеже с «и» перед последним", () => {
  assert.equal(usageFrom(tag("игры", 20, 0, 3)), "20 закладок и 3 игр");
  assert.equal(usageFrom(tag("игры", 1, 1, 1)), "1 закладки, 1 папки и 1 игры");
  assert.equal(usageFrom(tag("игры", 0, 0, 2)), "2 игр");
});

test("текст слияния с числами обоих тегов", () => {
  assert.equal(mergeText(tag("игры", 20, 0, 3), tag("Игры PC", 2)), "у тегов 23 и 2 карточки");
  assert.equal(mergeText(tag("игры", 1), tag("Игры PC", 5)), "у тегов 1 и 5 карточек");
});

test("слова окна по виду карточки", () => {
  assert.deepEqual(targetWord({ kind: "bookmark", id: 1 }), { of: "закладки", back: "К закладке" });
  assert.deepEqual(targetWord({ kind: "folder", id: 1 }), { of: "папки", back: "К папке" });
  assert.deepEqual(targetWord({ kind: "game", id: 1 }), { of: "игры", back: "К игре" });
});

test("фильтр витрины идёт за переименованием на том же месте", () => {
  assert.deepEqual(renameSelected(["Rust", "игры", "шрифты"], "Игры", "Игры PC"), ["Rust", "Игры PC", "шрифты"]);
});

test("фильтр витрины после слияния не держит оба тега", () => {
  assert.deepEqual(renameSelected(["игры", "Rust", "Игры PC"], "игры", "игры pc"), ["игры pc", "Rust"]);
});

test("фильтр на цели слияния получает написание, введённое при слиянии", () => {
  assert.deepEqual(renameSelected(["Rust", "Игры PC"], "игры", "игры pc"), ["Rust", "игры pc"]);
});

test("переименование невыбранного тега фильтр не трогает", () => {
  const selected = ["Rust"];
  assert.equal(renameSelected(selected, "игры", "кино"), selected);
});

test("удалённый тег снимается с фильтра без учёта регистра", () => {
  assert.deepEqual(dropSelected(["Rust", "Игры"], "игры"), ["Rust"]);
  const selected = ["Rust"];
  assert.equal(dropSelected(selected, "игры"), selected);
});

test("строка в настройках: число тегов и сколько нигде не стоят", () => {
  assert.equal(tagsSummary([]), "Тегов пока нет");
  assert.equal(tagsSummary([tag("новелла"), tag("визуальная новелла")]), "2 тега · 2 нигде не стоят");
  assert.equal(tagsSummary([tag("игры", 1), tag("мусор")]), "2 тега · 1 нигде не стоит");
  assert.equal(tagsSummary([tag("игры", 1)]), "1 тег");
  assert.equal(tagsSummary(Array.from({ length: 11 }, (_, i) => tag(`т${i}`, 1))), "11 тегов");
});
