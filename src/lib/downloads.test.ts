import test from "node:test";
import assert from "node:assert/strict";

import {
  canDownload,
  downloadButtonLabel,
  progressByGame,
  queueStatus,
  rowLabel,
  rowPercent,
  rowPhase,
  selectedWeight,
} from "./downloads.ts";
import type { DownloadRow, Game, UnclaimedArchive } from "./types.ts";

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
    title: "Игра",
    state: "waiting",
    reason: null,
    message: null,
    archiveName: null,
    unpackDone: 0,
    unpackTotal: 0,
    ...patch,
  };
}

test("canDownload: хочу, без папки, тема на форуме", () => {
  assert.equal(canDownload(game({})), true);
  assert.equal(canDownload(game({ status: "new" })), false);
  assert.equal(canDownload(game({ folderPath: "E:\\Games\\X" })), false);
  assert.equal(canDownload(game({ downloadLinks: [] })), true);
  assert.equal(canDownload(game({ pageUrl: null })), false);
  assert.equal(canDownload(game({ pageUrl: "https://itch.io/g/x" })), false);
  assert.equal(canDownload(game({ pageUrl: "https://f95zone.to/threads/12345/" })), true);
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

test("rowPercent: только распаковка и готово", () => {
  assert.equal(rowPercent(row({ state: "unpacking", unpackDone: 2, unpackTotal: 5 })), 40);
  assert.equal(rowPercent(row({ state: "unpacking" })), null);
  assert.equal(rowPercent(row({ state: "done" })), 100);
  assert.equal(rowPercent(row({ state: "waiting" })), null);
  assert.equal(rowPercent(row({ state: "queued" })), null);
});

test("rowPhase и rowLabel", () => {
  assert.equal(rowPhase(row({ state: "waiting" })), "Ждём файл");
  assert.equal(rowPhase(row({ state: "queued" })), "Архив найден");
  assert.equal(rowPhase(row({ state: "unpacking" })), "Распаковываем");
  assert.equal(rowPhase(row({ state: "done" })), "Готово");
  assert.equal(rowPhase(row({ state: "failed" })), "Сбой");
  assert.equal(rowLabel(row({ state: "waiting" })), "Скачай архив в браузере — Booked подхватит его сам");
  assert.equal(rowLabel(row({ state: "queued", archiveName: "NewStart-0.2-pc.zip" })), "NewStart-0.2-pc.zip");
  assert.equal(
    rowLabel(row({ state: "unpacking", unpackDone: 3.7 * 1024 ** 3, unpackTotal: 8.1 * 1024 ** 3 })),
    `3,7${NB}ГБ из 8,1${NB}ГБ`,
  );
  assert.equal(rowLabel(row({ state: "unpacking", archiveName: "a.zip" })), "a.zip");
  assert.equal(rowLabel(row({ state: "done" })), "");
  assert.equal(rowLabel(row({ state: "failed", message: "Архива уже нет" })), "Архива уже нет");
  assert.equal(rowLabel(row({ state: "failed" })), "Не получилось распаковать архив");
});

test("progressByGame: готовые не считаются, ожидание без процента", () => {
  const map = progressByGame([
    row({ game: 1, state: "unpacking", unpackDone: 1, unpackTotal: 2 }),
    row({ id: 2, game: 2, state: "waiting" }),
    row({ id: 3, game: 3, state: "done" }),
  ]);
  assert.equal(map.get(1), 50);
  assert.equal(map.get(2), null);
  assert.equal(map.has(3), false);
});

test("queueStatus", () => {
  const offer: UnclaimedArchive = { id: 9, name: "x.zip", options: [1] };
  const status = (rows: DownloadRow[], unclaimed: UnclaimedArchive[] = []) => queueStatus({ rows, unclaimed });
  assert.deepEqual(status([row({ state: "waiting" })]), { mood: "waiting", percent: null, text: `1${NB}игра ждёт файл` });
  assert.equal(status([row({ state: "waiting" }), row({ id: 2, state: "waiting" })]).text, `2${NB}игры ждут файл`);
  assert.deepEqual(
    status([row({ state: "unpacking", unpackDone: 1, unpackTotal: 4 }), row({ id: 2, state: "waiting" }), row({ id: 3, state: "queued" })]),
    { mood: "unpacking", percent: 25, text: `Распаковываем · 25${NB}% · ещё${NB}2 в${NB}очереди` },
  );
  assert.deepEqual(status([row({ state: "waiting" })], [offer]), { mood: "unclaimed", percent: null, text: "Чей архив?" });
  assert.deepEqual(status([row({ state: "queued" }), row({ id: 2, state: "waiting" })]), {
    mood: "queued",
    percent: null,
    text: `1${NB}игра ждёт распаковки`,
  });
  assert.equal(status([row({ state: "failed" }), row({ id: 2, state: "done" })]).text, `1${NB}сбой`);
  assert.deepEqual(status([row({ state: "done" }), row({ id: 2, state: "done" })]), { mood: "done", percent: 100, text: `2${NB}игры готовы` });
  assert.equal(status([row({ state: "done" })]).text, `1${NB}игра готова`);
});
