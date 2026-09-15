export const FOUND_GAMES_LIMIT = 5;

export function matchGames<T extends { title: string }>(games: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return games.filter((game) => game.title.toLowerCase().includes(needle));
}

export function foundGamesPage<T>(hits: readonly T[], limit = FOUND_GAMES_LIMIT): { shown: T[]; extra: number } {
  const shown = hits.slice(0, limit);
  return { shown, extra: hits.length - shown.length };
}

export function stripWheel(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  deltaX: number,
  deltaY: number,
): number | null {
  if (deltaY === 0 || Math.abs(deltaX) >= Math.abs(deltaY)) return null;
  const max = scrollWidth - clientWidth;
  if (max <= 0) return null;
  if (deltaY < 0 && scrollLeft <= 0) return null;
  if (deltaY > 0 && scrollLeft >= max - 0.5) return null;
  return Math.min(max, Math.max(0, scrollLeft + deltaY));
}
