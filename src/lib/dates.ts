const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("ru-RU", options);
    formatters.set(key, formatter);
  }
  return formatter;
}

export function shortRu(ts: number): string {
  return dateFormat({ day: "numeric", month: "short" }).format(ts * 1000);
}

export function absoluteRu(ts: number): string {
  return dateFormat({ day: "2-digit", month: "2-digit", year: "numeric" }).format(ts * 1000);
}

export function longWithTimeRu(ts: number): string {
  const date = new Date(ts * 1000);
  const datePart = dateFormat({ day: "numeric", month: "long", year: "numeric" }).format(date);
  const timePart = dateFormat({ hour: "2-digit", minute: "2-digit" }).format(date);
  return `${datePart}, ${timePart}`;
}

export function isoDateForFilename(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoStampForFilename(now: Date): string {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${isoDateForFilename(now)}-${hours}${minutes}${seconds}`;
}

let relativeFormatter: Intl.RelativeTimeFormat | null = null;

export function relativeRu(ts: number, now: number): string {
  const diffDays = Math.floor((now - ts) / 86400);
  const rtf = (relativeFormatter ??= new Intl.RelativeTimeFormat("ru-RU", { numeric: "auto", style: "short" }));

  if (diffDays < 1) return rtf.format(0, "day");
  if (diffDays < 2) return rtf.format(-1, "day");
  if (diffDays < 30) return rtf.format(-diffDays, "day");

  const diffMonths = Math.floor(diffDays / 30);
  return rtf.format(-diffMonths, "month");
}
