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
  return installed ? `Вышла ${siteVersion}, у вас ${installed}` : `На сайте ${siteVersion}`;
}
