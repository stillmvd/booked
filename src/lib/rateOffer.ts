export interface RateAsk {
  id: number;
  startedAt: number;
  endedAt: number | null;
  armed: boolean;
  at: number;
}

export function arrive(queue: readonly RateAsk[], id: number, startedAt: number, focused: boolean, now: number): RateAsk[] {
  return [...queue.filter((ask) => ask.id !== id), { id, startedAt, endedAt: null, armed: focused, at: now }];
}

export function armAll(queue: readonly RateAsk[]): readonly RateAsk[] {
  return queue.every((ask) => ask.armed) ? queue : queue.map((ask) => ({ ...ask, armed: true }));
}

export function gameEnded(queue: readonly RateAsk[], id: number, now: number): RateAsk[] {
  return queue.map((ask) => (ask.id === id && ask.endedAt === null ? { ...ask, endedAt: now, armed: true } : ask));
}

export function dismiss(queue: readonly RateAsk[], id: number): RateAsk[] {
  return queue.filter((ask) => ask.id !== id);
}

export function visibleAsk(queue: readonly RateAsk[]): { ask: RateAsk; more: number } | null {
  const armed = queue.filter((ask) => ask.armed);
  if (armed.length === 0) return null;
  const ask = armed.reduce((last, next) => (next.at >= last.at ? next : last));
  return { ask, more: armed.length - 1 };
}

export function playedText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `Сыграно ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return `Сыграно ${hours} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}

export function frequentGameTags(games: readonly { tags: readonly string[] }[], limit = 8): string[] {
  const counts = new Map<string, number>();
  games.forEach((game) => game.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .slice(0, limit)
    .map(([name]) => name);
}
