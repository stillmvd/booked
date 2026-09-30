import type { GameStatus } from "./types.ts";

export const STATUS_LABELS: Record<GameStatus, string> = {
  new: "Не начата",
  playing: "Прохожу",
  finished: "Пройдена",
  dropped: "Брошена",
};

const SIZE_UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"];

export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} ${SIZE_UNITS[0]}`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded).replace(".", ",")} ${SIZE_UNITS[unit]}`;
}

export function withV(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}

export function splitExePath(path: string): { name: string; folder: string } {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut < 0) return { name: path, folder: "" };
  return { name: path.slice(cut + 1) || path, folder: path.slice(0, cut) };
}

export function formatSiteStamp(stamp: string | null, now: number = Date.now()): string {
  if (!stamp) return "";
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return "";
  const sameYear = parsed.getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function updateDay(at: number, now: number = Date.now()): string {
  const day = new Date(at * 1000);
  const sameYear = day.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: sameYear ? undefined : "numeric" }).format(day);
}

export function isVersionNumber(version: string): boolean {
  return /^\d[\da-z.]*$/i.test(version.trim());
}

export function updateLabel(
  source: "f95" | "itch" | null,
  siteVersion: string | null,
  installed: string | null,
  now: number = Date.now(),
): string {
  if (!siteVersion) return "";
  if (source === "itch") {
    const when = formatSiteStamp(siteVersion, now);
    return when ? `Обновлено ${when}` : "";
  }
  if (!isVersionNumber(siteVersion)) return `На сайте что-то вышло: ${siteVersion}`;
  return installed ? `Вышла ${siteVersion}, у вас ${installed}` : `На сайте ${siteVersion}`;
}
