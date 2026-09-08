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

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function formatLastLaunched(stamp: number | null, now: number = Date.now()): string {
  if (stamp === null || !Number.isFinite(stamp) || stamp <= 0) return "Ещё не запускалась";
  const days = Math.floor((now - stamp * 1000) / 86_400_000);
  if (days < 0) return "Запускалась только что";
  if (days === 0) return "Запускалась сегодня";
  if (days === 1) return "Запускалась вчера";
  if (days < 31) return `Запускалась ${days} ${plural(days, "день", "дня", "дней")} назад`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Запускалась ${months} ${plural(months, "месяц", "месяца", "месяцев")} назад`;
  const years = Math.floor(days / 365);
  return `Запускалась ${years} ${plural(years, "год", "года", "лет")} назад`;
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
