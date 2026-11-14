import { formatSize } from "./gameFormat.ts";
import { pluralizeRu } from "./pluralizeRu.ts";
import type { DownloadRow, DownloadSnapshot, Game } from "./types.ts";

const NBSP = " ";

export const EMPTY_DOWNLOADS: DownloadSnapshot = { rows: [], unclaimed: [] };

function size(bytes: number | null): string {
  return formatSize(bytes).replace(" ", NBSP);
}

export function threadId(pageUrl: string | null): number | null {
  const match = /^https?:\/\/(?:[^/]+\.)?f95zone\.[a-z]+\/threads\/(?:[^/?#]*\.)?(\d+)(?:[/?#]|$)/i.exec(pageUrl ?? "");
  return match ? Number(match[1]) : null;
}

export function canDownload(game: Game): boolean {
  return game.status === "wish" && game.folderPath === null && threadId(game.pageUrl) !== null;
}

export function selectedWeight(games: Game[], ids: ReadonlySet<number>): number | null {
  let sum = 0;
  let known = false;
  for (const game of games) {
    if (!ids.has(game.id) || game.sizeBytes === null || !(game.sizeBytes > 0)) continue;
    sum += game.sizeBytes;
    known = true;
  }
  return known ? sum : null;
}

export function downloadButtonLabel(count: number, weight: number | null): string {
  return weight === null ? `Скачать ${count}` : `Скачать ${count} · ${size(weight)}`;
}

export function rowPercent(row: DownloadRow): number | null {
  if (row.state === "done") return 100;
  if (row.state !== "unpacking" || row.unpackTotal <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((row.unpackDone / row.unpackTotal) * 100)));
}

export function rowPhase(row: DownloadRow): string {
  switch (row.state) {
    case "waiting":
      return "Ждём файл";
    case "queued":
      return "Архив найден";
    case "unpacking":
      return "Распаковываем";
    case "done":
      return "Готово";
    case "failed":
      return "Сбой";
  }
}

export function rowLabel(row: DownloadRow): string {
  switch (row.state) {
    case "waiting":
      return "Скачай архив в браузере — Booked подхватит его сам";
    case "queued":
      return row.archiveName ?? "";
    case "done":
      return "";
    case "unpacking":
      return row.unpackTotal > 0 ? `${size(row.unpackDone)} из ${size(row.unpackTotal)}` : row.archiveName ?? "";
    case "failed":
      return row.message ?? "Не получилось распаковать архив";
  }
}

export function coverProgress(row: DownloadRow): number | null {
  return row.state === "unpacking" ? rowPercent(row) : null;
}

export function progressByGame(rows: DownloadRow[]): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (const row of rows) {
    if (row.state === "done") continue;
    map.set(row.game, coverProgress(row));
  }
  return map;
}

export type QueueMood = "unpacking" | "unclaimed" | "queued" | "failed" | "waiting" | "done";

export interface QueueStatus {
  mood: QueueMood;
  percent: number | null;
  text: string;
}

export function queueStatus(snapshot: DownloadSnapshot): QueueStatus {
  const { rows, unclaimed } = snapshot;
  const count = (state: DownloadRow["state"]) => rows.filter((row) => row.state === state).length;
  const games = (n: number) => `${n}${NBSP}${pluralizeRu(n, ["игра", "игры", "игр"])}`;
  const one = (n: number) => n % 10 === 1 && n % 100 !== 11;
  const active = rows.find((row) => row.state === "unpacking");
  if (active) {
    const percent = rowPercent(active);
    const rest = count("queued") + count("waiting");
    const parts = [rowPhase(active)];
    if (percent !== null) parts.push(`${percent}${NBSP}%`);
    if (rest > 0) parts.push(`ещё${NBSP}${rest} в${NBSP}очереди`);
    return { mood: "unpacking", percent, text: parts.join(" · ") };
  }
  if (unclaimed.length > 0) return { mood: "unclaimed", percent: null, text: "Чей архив?" };
  const failed = count("failed");
  if (failed > 0) return { mood: "failed", percent: null, text: `${failed}${NBSP}${pluralizeRu(failed, ["сбой", "сбоя", "сбоев"])}` };
  const queued = count("queued");
  if (queued > 0) return { mood: "queued", percent: null, text: `${games(queued)} ${one(queued) ? "ждёт" : "ждут"} распаковки` };
  const waiting = count("waiting");
  if (waiting > 0) return { mood: "waiting", percent: null, text: `${games(waiting)} ${one(waiting) ? "ждёт" : "ждут"} файл` };
  return { mood: "done", percent: 100, text: `${games(rows.length)} ${one(rows.length) ? "готова" : "готовы"}` };
}
