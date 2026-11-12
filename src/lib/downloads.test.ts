import test from "node:test";
import assert from "node:assert/strict";

import {
  canDownload,
  downloadButtonLabel,
  formatEta,
  hostLabel,
  progressByGame,
  queueCapsuleLabel,
  rowLabel,
  rowPercent,
  selectedWeight,
} from "./downloads.ts";
import type { DownloadRow, Game } from "./types.ts";

const NB = "\u00a0";

function game(patch: Partial<Game>): Game {
  return {
    id: 1,
    status: "wish",
    pageUrl: "https://f95zone.to/threads/some-game-v1-0.12345/",
    folderPath: null,
    sizeBytes: null,
    downloadLinks: [{ host: " PixelDrain ", url: "https://x" }],
    ...patch,
  } as Game;
}

function row(patch: Partial<DownloadRow>): DownloadRow {
  return {
    id: 1,
    game: 1,
    thread: 1,
    title: "Игра",
    hosts: ["pixeldrain"],
    state: "waiting",
    reason: null,
    message: null,
    host: null,
    url: null,
    received: 0,
    total: null,
    speed: 0,
    etaSecs: null,
    unpackDone: 0,
    unpackTotal: 0,
    stalled: false,
    ...patch,
  };
}

test("canDownload: хочу, без папки, поддерживаемый хост", () => {
  assert.equal(canDownload(game({})), true);
  assert.equal(canDownload(game({ status: "new" })), false);
  assert.equal(canDownload(game({ folderPath: "E:\\Games\\X" })), false);
  assert.equal(canDownload(game({ downloadLinks: [{ host: "MEGA", url: "u" }] })), false);
  assert.equal(canDownload(game({ downloadLinks: [] })), false);
  assert.equal(canDownload(game({ pageUrl: null })), false);
  assert.equal(canDownload(game({ pageUrl: "https://itch.io/g/x" })), false);
  assert.equal(canDownload(game({ pageUrl: "https://f95zone.to/threads/12345/" })), true);
  assert.equal(canDownload(game({ downloadLinks: [{ host: "MEGA", url: "u" }, { host: "MediaFire", url: "u" }] })), true);
});

test("selectedWeight: неизвестный вес не считается", () => {
  const games = [game({ id: 1, sizeBytes: 1024 ** 3 }), game({ id: 2, sizeBytes: null }), game({ id: 3, sizeBytes: 1024 ** 3 })];
  assert.equal(selectedWeight(games, new Set([1, 2, 3])), 2 * 1024 ** 3);
  assert.equal(selectedWeight(games, new Set([2])), null);
  assert.equal(selectedWeight(games, new Set()), null);
});

test("downloadButtonLabel", () => {
  assert.equal(downloadButtonLabel(3, 7.4 * 1024 ** 3), `Скачать 3 · 7,4${NB}ГБ`);
  assert.equal(downloadButtonLabel(2, null), "Скачать 2");
});

test("formatEta", () => {
  assert.equal(formatEta(20), "осталось меньше минуты");
  assert.equal(formatEta(150), `осталось 3${NB}мин`);
  assert.equal(formatEta(4800), `осталось 1${NB}ч 20${NB}мин`);
  assert.equal(formatEta(7200), `осталось 2${NB}ч`);
});

test("hostLabel", () => {
  assert.equal(hostLabel("PIXELDRAIN"), "Pixeldrain");
  assert.equal(hostLabel(" buzzheavier "), "Buzzheavier");
});

test("rowPercent", () => {
  assert.equal(rowPercent(row({ state: "downloading", received: 42, total: 100 })), 42);
  assert.equal(rowPercent(row({ state: "downloading", received: 5, total: null })), null);
  assert.equal(rowPercent(row({ state: "downloading", received: 500, total: 100 })), 100);
  assert.equal(rowPercent(row({ state: "unpacking", unpackDone: 2, unpackTotal: 5 })), 40);
  assert.equal(rowPercent(row({ state: "done" })), 100);
  assert.equal(rowPercent(row({ state: "waiting" })), null);
});

test("rowLabel", () => {
  assert.equal(rowLabel(row({ state: "waiting" })), "В очереди");
  assert.equal(rowLabel(row({ state: "resolving" })), "Ищем ссылку…");
  assert.equal(rowLabel(row({ state: "resolving", stalled: true })), "Ждём расширение Sorter 95 в браузере");
  assert.equal(
    rowLabel(row({ state: "downloading", host: "PIXELDRAIN", received: 10, total: 100, speed: 12 * 1024 ** 2, etaSecs: 150 })),
    `Pixeldrain · 12${NB}МБ/с · осталось 3${NB}мин`,
  );
  assert.equal(
    rowLabel(row({ state: "downloading", host: "pixeldrain", received: 1.3 * 1024 ** 3, total: null, speed: 12 * 1024 ** 2 })),
    `1,3${NB}ГБ · 12${NB}МБ/с`,
  );
  assert.equal(rowLabel(row({ state: "unpacking", unpackDone: 2, unpackTotal: 5 })), `Распаковываем · 40${NB}%`);
  assert.equal(rowLabel(row({ state: "done" })), "Готово");
  assert.equal(rowLabel(row({ state: "failed", message: "Ссылка устарела" })), "Ссылка устарела");
});

test("progressByGame: готовые не считаются, ожидание без процента", () => {
  const map = progressByGame([
    row({ game: 1, state: "downloading", received: 50, total: 100 }),
    row({ id: 2, game: 2, state: "waiting" }),
    row({ id: 3, game: 3, state: "done" }),
  ]);
  assert.equal(map.get(1), 50);
  assert.equal(map.get(2), null);
  assert.equal(map.has(3), false);
});

test("queueCapsuleLabel", () => {
  assert.equal(queueCapsuleLabel([row({ state: "waiting" })]), "Загрузки 1");
  assert.equal(
    queueCapsuleLabel([row({ state: "downloading", received: 42, total: 100 }), row({ id: 2, state: "waiting" })]),
    `Загрузки 2 · 42${NB}%`,
  );
});
