import test from "node:test";
import assert from "node:assert/strict";

import {
  changedLabel,
  exeLabel,
  leavingLine,
  matchLine,
  rowSubline,
  mergeVerb,
  newestIds,
  noteSubline,
  noteTitle,
  openGroups,
  permanentQuestion,
  reasonPhrase,
  savesFact,
  savesLabel,
  toastText,
  trashLine,
  windowTitle,
} from "./gameVersions.ts";
import type { Game, GameMatchReasons, GameVersionGroup } from "./types.ts";

function game(id: number, title: string, version: string | null, folderName: string | null = null): Game {
  return {
    id,
    baseName: title.toLowerCase(),
    title,
    folderPath: folderName ? `E:\\Games\\${folderName}` : null,
    folderName,
    versionInstalled: version,
    versionSource: "folder",
    source: null,
    engine: null,
    pageUrl: null,
    image: null,
    imageX: 50,
    imageY: 50,
    status: "new",
    rating: 0,
    exePath: null,
    exeSource: "auto",
    sizeBytes: null,
    lastLaunchedAt: null,
    siteVersion: null,
    seenVersion: null,
    skippedVersion: null,
    lastCheckedAt: null,
    tags: [],
    hasUpdate: false,
  };
}

const reasons = (over: Partial<GameMatchReasons>): GameMatchReasons => ({ name: false, page: null, exe: null, engine: null, ...over });

test("reason phrase names what matched in plain words", () => {
  assert.equal(reasonPhrase(reasons({ name: true, exe: "PathOfDesire.exe", engine: "Ren'Py" })), "Совпали имя папки и exe");
  assert.equal(reasonPhrase(reasons({ name: true })), "Совпало имя папки");
  assert.equal(reasonPhrase(reasons({ exe: "Post Nut Calamity.exe", engine: "Unity" })), "Совпал exe");
  assert.equal(reasonPhrase(reasons({ page: "f95" })), "Совпала страница F95");
  assert.equal(reasonPhrase(reasons({ name: true, exe: "a.exe", page: "itch" })), "Совпали имя папки, exe и страница itch.io");
  assert.equal(reasonPhrase(reasons({})), "Папки похожи по разным признакам");
  assert.equal(reasonPhrase(null), "Совпадений не нашлось");
});

test("reason chips follow the stand order", () => {
  assert.equal(matchLine(reasons({ name: true, exe: "ELFxNINJA.exe", engine: "Unity" })), "совпали имя папки, ELFxNINJA.exe и Unity");
  assert.equal(matchLine(reasons({ name: true })), "совпало имя папки");
  assert.equal(matchLine(reasons({ page: "f95" })), "совпала страница F95");
  assert.equal(matchLine(reasons({ exe: "Game.exe" })), "совпал Game.exe");
  assert.equal(matchLine(reasons({})), "каждая папка совпала с другими по своему признаку");
  assert.equal(matchLine(null), "совпадений не нашлось — проверьте, что это одна игра");
});

test("groups waiting for the toast or with unknown cards are hidden", () => {
  const groups: GameVersionGroup[] = [
    { ids: [21, 40], reasons: reasons({ name: true }) },
    { ids: [22, 38], reasons: reasons({ name: true }) },
  ];
  const known = new Set([21, 22, 38, 40]);
  assert.deepEqual(openGroups(groups, new Set(), known).length, 2);
  assert.deepEqual(openGroups(groups, new Set([40]), known), [groups[1]]);
  assert.deepEqual(openGroups(groups, new Set(), new Set([21, 40])), [groups[0]]);
});

test("badge goes to the newest card of its first group", () => {
  const first = { ids: [1, 3], reasons: reasons({ name: true }) };
  const second = { ids: [2, 3], reasons: reasons({ name: true }) };
  const marks = newestIds([first, second]);
  assert.equal(marks.size, 1);
  assert.equal(marks.get(3), first);
});

test("note shows versions and how many more games wait", () => {
  const games = new Map([
    [21, game(21, "Path Of Desire", "0.5.2")],
    [40, game(40, "Path Of Desire", "0.6.2")],
  ]);
  const group = { ids: [21, 40], reasons: reasons({ name: true, exe: "PathOfDesire.exe", engine: "Ren'Py" }) };
  assert.deepEqual(noteTitle(group, games), { title: "Path Of Desire", versions: "0.5.2 → 0.6.2" });
  assert.equal(noteSubline(group, 1), "Совпали имя папки и exe · и ещё 1 игра");
  assert.equal(noteSubline(group, 5), "Совпали имя папки и exe · и ещё 5 игр");
  assert.equal(noteSubline(group, 0), "Совпали имя папки и exe");
  assert.deepEqual(noteTitle({ ids: [21, 99], reasons: group.reasons }, games), { title: "Path Of Desire", versions: "" });
  const twin = new Map([
    [1, game(1, "Nested Game", "1.0", "Nested Game v1.0")],
    [2, game(2, "Nested Game", "1.0", "Nested Game v1.0 (2)")],
  ]);
  assert.deepEqual(noteTitle({ ids: [1, 2], reasons: group.reasons }, twin), { title: "Nested Game", versions: "1.0 · 2 копии" });
});

test("window title and buttons speak versions", () => {
  const kept = game(40, "Path Of Desire", "0.6.2", "PathOfDesire-0.6.2-pc");
  assert.equal(windowTitle(2, "Path Of Desire"), "Какую папку оставить?");
  assert.equal(windowTitle(3, "Path Of Desire"), "Три версии Path Of Desire");
  assert.equal(windowTitle(5, "Path Of Desire"), "Пять версий Path Of Desire");
  assert.equal(windowTitle(12, "Path Of Desire"), "12 версий Path Of Desire");
  assert.equal(mergeVerb(kept, 2, true), "Обновить до 0.6.2");
  assert.equal(mergeVerb(game(9, "Flee", null, "Flee_My_Elven_Ninja_v0504"), 2, true), "Обновить");
  assert.equal(mergeVerb(kept, 2, false), "Оставить старую");
  assert.equal(mergeVerb(game(45, "Path Of Desire", "0.7.0"), 3, true), "Оставить 0.7.0");
  assert.equal(toastText(game(21, "Path Of Desire", "0.5.2"), kept), "Path Of Desire обновлена до 0.6.2");
  assert.equal(toastText(game(21, "Flee My Elven Ninja", null), game(9, "Flee", null)), "Flee My Elven Ninja: осталась одна папка");
  assert.equal(savesFact(3, 0, true), "Сохранения из старой папки (3 файла) перенесутся в новую, если их там нет или они новее");
  assert.equal(savesFact(5, 0, false), "Сохранения из новой папки (5 файлов) перенесутся в старую, если их там нет или они новее");
  assert.equal(savesFact(0, 2, true), "В папке, которая уйдёт в Корзину, сохранений нет — переносить нечего");
  assert.equal(savesFact(0, 0, true), "Сохранений в папках нет — переносить нечего");
});

test("consequence lines use sizes and counts", () => {
  assert.equal(savesLabel(48, true), "48 файлов");
  assert.equal(savesLabel(0, true), "нет в папке");
  assert.equal(savesLabel(undefined, false), "—");
  assert.equal(
    trashLine("PathOfDesire-0.5.2-pc", 1_124_051_214, 0),
    "PathOfDesire-0.5.2-pc уйдёт в Корзину · 1 ГБ. Сохранений в ней нет.",
  );
  assert.equal(
    trashLine("PathOfDesire-0.6.2-pc", 1_223_846_589, 48),
    "PathOfDesire-0.6.2-pc уйдёт в Корзину · 1,1 ГБ. Сохранения из неё (48 файлов) скопируются, если их нет или они новее.",
  );
  assert.equal(permanentQuestion("Huge", 12_348_030_976), "Корзина не примет 11,5 ГБ");
});

test("table cells read like the stand", () => {
  const now = new Date(2026, 8, 17).getTime();
  const old = { ...game(21, "Path Of Desire", "0.5.2", "PathOfDesire-0.5.2-pc"), pageUrl: "https://f95zone.to/threads/1/", source: "f95" as const, siteVersion: "0.7.0", hasUpdate: true, exePath: "PathOfDesire.exe" };
  assert.equal(changedLabel(new Date(2026, 6, 29).getTime(), now), "29 июля");
  assert.equal(changedLabel(new Date(2025, 6, 29).getTime(), now), "29 июля 2025 г.");
  assert.equal(changedLabel(null, now), "—");
  assert.equal(exeLabel({ ...old, exePath: String.raw`bin\Start.exe` }), "Start.exe");
  assert.equal(exeLabel(game(1, "A", null)), "—");
  assert.equal(rowSubline(old, 1_124_051_214, new Date(2026, 6, 29).getTime(), now), "0.5.2 · 1 ГБ · изменена 29 июля · страница F95");
  assert.equal(rowSubline(game(1, "A", null), null, null, now), "");
});

test("leaving line counts folders to the Recycle Bin", () => {
  assert.equal(leavingLine([]), "Старой папки нет на диске — в Корзину ничего не уйдёт.");
  assert.equal(
    leavingLine([
      { name: "PathOfDesire-0.5.2-pc", bytes: 1_124_051_214, saves: 0 },
      { name: "PathOfDesire-0.6.2-pc", bytes: 1_223_846_589, saves: 48 },
    ]),
    "2 папки уйдут в Корзину · 2,2 ГБ. Сохранения из них скопируются, если их нет или они новее.",
  );
});
