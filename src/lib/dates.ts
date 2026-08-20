export function shortRu(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(ts * 1000);
}

export function absoluteRu(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    ts * 1000,
  );
}

export function relativeRu(ts: number, now: number): string {
  const diffDays = Math.floor((now - ts) / 86400);
  const rtf = new Intl.RelativeTimeFormat("ru-RU", { numeric: "auto", style: "short" });

  if (diffDays < 1) return rtf.format(0, "day");
  if (diffDays < 2) return rtf.format(-1, "day");
  if (diffDays < 30) return rtf.format(-diffDays, "day");

  const diffMonths = Math.floor(diffDays / 30);
  return rtf.format(-diffMonths, "month");
}
