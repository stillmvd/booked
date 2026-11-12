import { formatSize } from "./gameFormat.ts";
import type { DownloadRow, DownloadSnapshot, Game } from "./types.ts";

const NBSP = " ";
const SUPPORTED_HOSTS = ["pixeldrain", "buzzheavier", "mediafire"];

export const EMPTY_DOWNLOADS: DownloadSnapshot = { rows: [], paused: false };

function size(bytes: number | null): string {
  return formatSize(bytes).replace(" ", NBSP);
}

function normHost(host: string): string {
  return host.trim().toLowerCase();
}

export function hostLabel(host: string): string {
  const clean = normHost(host);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "";
}

export function threadId(pageUrl: string | null): number | null {
  const match = /^https?:\/\/(?:[^/]+\.)?f95zone\.[a-z]+\/threads\/(?:[^/?#]*\.)?(\d+)(?:[/?#]|$)/i.exec(pageUrl ?? "");
  return match ? Number(match[1]) : null;
}

export function canDownload(game: Game): boolean {
  if (game.status !== "wish" || game.folderPath !== null || threadId(game.pageUrl) === null) return false;
  return game.downloadLinks.some((link) => SUPPORTED_HOSTS.includes(normHost(link.host)));
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

export function rowLabel(row: DownloadRow): string {
  switch (row.state) {
    case "waiting":
      return "В очереди";
    case "resolving":
      return row.stalled ? "Ждём расширение Sorter 95 в браузере" : "Ищем ссылку…";
    case "downloading": {
      const parts: string[] = [];
      const host = row.host ?? row.hosts[0] ?? "";
      if (row.total === null || row.total <= 0) {
        parts.push(size(row.received));
      } else if (host) {
        parts.push(hostLabel(host));
      }
      if (row.speed > 0) parts.push(formatSpeed(row.speed));
      if (row.etaSecs !== null && row.total !== null && row.total > 0) parts.push(formatEta(row.etaSecs));
      return parts.join(" · ");
    }
    case "unpacking": {
      const percent = rowPercent(row);
      return percent === null ? "Распаковываем" : `Распаковываем · ${percent}${NBSP}%`;
    }
    case "done":
      return "Готово";
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

export function queueCapsuleLabel(rows: DownloadRow[]): string {
  const active = rows.find((row) => row.state === "downloading");
  const percent = active ? rowPercent(active) : null;
  return percent === null ? `Загрузки ${rows.length}` : `Загрузки ${rows.length} · ${percent}${NBSP}%`;
}
