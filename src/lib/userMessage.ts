const KNOWN: Record<string, string> = {
  cycle: "Нельзя перенести папку в саму себя или в её содержимое",
};

const HAS_RUSSIAN = /[а-яё]/i;
const FALLBACK = "Не получилось сохранить. Попробуйте ещё раз.";

export function userMessage(err: unknown): string {
  console.error(err);
  const raw = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  const trimmed = raw.trim();
  const known = KNOWN[trimmed];
  if (known) return known;
  if (HAS_RUSSIAN.test(trimmed)) return trimmed;
  return FALLBACK;
}
