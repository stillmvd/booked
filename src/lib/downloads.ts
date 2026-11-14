import { formatSize } from "./gameFormat.ts";
import { pluralizeRu } from "./pluralizeRu.ts";
import type { DownloadRow, DownloadSnapshot, Game } from "./types.ts";

const NBSP = " ";

export const EMPTY_DOWNLOADS: DownloadSnapshot = { rows: [], paused: false };

function size(bytes: number | null): string {
  return formatSize(bytes).replace(" ", NBSP);
}

export function hostLabel(host: string): string {
  const clean = host.trim().toLowerCase();
  if (clean === "file") return "Файл по ссылке";
  if (clean === "mediafire") return "MediaFire";
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "";
}

export function threadId(pageUrl: string | null): number | null {
  const match = /^https?:\/\/(?:[^/]+\.)?f95zone\.[a-z]+\/threads\/(?:[^/?#]*\.)?(\d+)(?:[/?#]|$)/i.exec(pageUrl ?? "");
  return match ? Number(match[1]) : null;
}

export function canDownload(game: Game): boolean {
  return game.status === "wish" && game.folderPath === null && threadId(game.pageUrl) !== null;
}

export function needsLink(row: DownloadRow): boolean {
  return row.state === "waiting" || row.state === "failed";
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

export function formatEta(secs: number): string {
  if (secs < 60) return "осталось меньше минуты";
  const minutes = Math.ceil(secs / 60);
  if (minutes < 60) return `осталось ${minutes}${NBSP}мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `осталось ${hours}${NBSP}ч`
    : `осталось ${hours}${NBSP}ч ${rest}${NBSP}мин`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${size(bytesPerSec)}/с`;
}

export function rowPercent(row: DownloadRow): number | null {
  if (row.state === "done") return 100;
  if (row.state === "downloading") {
    if (row.total === null || row.total <= 0) return null;
    return Math.max(0, Math.min(100, Math.floor((row.received / row.total) * 100)));
  }
  if (row.state === "unpacking") {
    if (row.unpackTotal <= 0) return null;
    return Math.max(0, Math.min(100, Math.floor((row.unpackDone / row.unpackTotal) * 100)));
  }
  return null;
}

export function rowPhase(row: DownloadRow): string {
  switch (row.state) {
    case "waiting":
      return "Нужна ссылка";
    case "queued":
      return "В очереди";
    case "downloading":
      return "Скачиваем";
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
    case "queued":
    case "done":
      return "";
    case "downloading": {
      const known = row.total !== null && row.total > 0;
      const parts: string[] = [known ? `${size(row.received)} из ${size(row.total)}` : size(row.received)];
      if (row.speed > 0) parts.push(formatSpeed(row.speed));
      if (row.etaSecs !== null && known) parts.push(formatEta(row.etaSecs));
      return parts.join(" · ");
    }
    case "unpacking":
      return row.unpackTotal > 0 ? `${size(row.unpackDone)} из ${size(row.unpackTotal)}` : "";
    case "failed":
      return row.message ?? "Не получилось скачать";
  }
}

export function coverProgress(row: DownloadRow): number | null {
  return row.state === "downloading" || row.state === "unpacking" ? rowPercent(row) : null;
}

export function progressByGame(rows: DownloadRow[]): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (const row of rows) {
    if (row.state === "done") continue;
    map.set(row.game, coverProgress(row));
  }
  return map;
}

export type QueueMood = "downloading" | "unpacking" | "queued" | "paused" | "failed" | "waiting" | "done";

export interface QueueStatus {
  mood: QueueMood;
  percent: number | null;
  text: string;
}

export function queueStatus(snapshot: DownloadSnapshot): QueueStatus {
  const { rows } = snapshot;
  const count = (state: DownloadRow["state"]) => rows.filter((row) => row.state === state).length;
  const games = (n: number) => `${n}${NBSP}${pluralizeRu(n, ["игра", "игры", "игр"])}`;
  const active = rows.find((row) => row.state === "downloading" || row.state === "unpacking");
  if (active) {
    const percent = rowPercent(active);
    const rest = count("queued") + count("waiting");
    const parts = [rowPhase(active)];
    if (percent !== null) parts.push(`${percent}${NBSP}%`);
    if (rest > 0) parts.push(`ещё${NBSP}${rest}`);
    return { mood: active.state as QueueMood, percent, text: parts.join(" · ") };
  }
  if (snapshot.paused) return { mood: "paused", percent: null, text: "Очередь на паузе" };
  const failed = count("failed");
  if (failed > 0) return { mood: "failed", percent: null, text: `${failed}${NBSP}${pluralizeRu(failed, ["сбой", "сбоя", "сбоев"])}` };
  const queued = count("queued");
  if (queued > 0) return { mood: "queued", percent: null, text: `${games(queued)} в${NBSP}очереди` };
  const waiting = count("waiting");
  if (waiting > 0) return { mood: "waiting", percent: null, text: `${games(waiting)} ${waiting % 10 === 1 && waiting % 100 !== 11 ? "ждёт" : "ждут"} ссылку` };
  return { mood: "done", percent: 100, text: `Скачано: ${games(rows.length)}` };
}
