import type { GamesLibrary } from "./types";

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function keepIfSame<T>(prev: T, next: T): T {
  return same(prev, next) ? prev : next;
}

export function reuseById<T extends { id: number }>(prev: T[], next: T[]): T[] {
  const byId = new Map(prev.map((item) => [item.id, item]));
  let unchanged = prev.length === next.length;
  const out = next.map((item, index) => {
    const old = byId.get(item.id);
    const kept = old !== undefined && same(old, item) ? old : item;
    if (kept !== prev[index]) unchanged = false;
    return kept;
  });
  return unchanged ? prev : out;
}

export function reuseLibrary(prev: GamesLibrary | null, next: GamesLibrary): GamesLibrary {
  if (!prev) return next;
  const games = reuseById(prev.games, next.games);
  const versions = same(prev.versions, next.versions) ? prev.versions : next.versions;
  if (games === prev.games && versions === prev.versions && prev.root === next.root && prev.rootAvailable === next.rootAvailable) {
    return prev;
  }
  return { ...next, games, versions };
}
