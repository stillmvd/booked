export interface TaggedGame {
  tags: string[];
  forumTags: string[];
}

export interface TagRow {
  name: string;
  count: number;
  forum: boolean;
}

export const TAG_LIMIT = 8;
export const NOTE_LIMIT = 500;

export function hasAllTags(game: { tags: string[] }, selected: string[]): boolean {
  return selected.every((name) => game.tags.includes(name));
}

export function toggleTag(selected: string[], name: string): string[] {
  return selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name];
}

export function tagRows(universe: TaggedGame[], matched: TaggedGame[]): TagRow[] {
  const rows = new Map<string, TagRow>();
  for (const game of universe) {
    for (const name of game.tags) {
      const row = rows.get(name) ?? { name, count: 0, forum: false };
      if (game.forumTags.includes(name)) row.forum = true;
      rows.set(name, row);
    }
  }
  for (const game of matched) {
    for (const name of game.tags) {
      const row = rows.get(name);
      if (row) row.count += 1;
    }
  }
  return Array.from(rows.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
}

export function ownTagCounts(games: TaggedGame[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const game of games) {
    for (const name of game.tags) {
      if (!game.forumTags.includes(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

export function visibleTagRows(
  rows: TagRow[],
  selected: string[],
  expanded: boolean,
  limit = TAG_LIMIT,
): { shown: TagRow[]; hidden: number } {
  if (expanded || rows.length <= limit) return { shown: rows, hidden: 0 };
  const shown = rows.filter((row, index) => index < limit || selected.includes(row.name));
  return { shown, hidden: rows.length - shown.length };
}

export function withoutGame(rows: TagRow[], own: string[]): TagRow[] {
  return rows.map((row) => (own.includes(row.name) ? { ...row, count: Math.max(0, row.count - 1) } : row));
}

export function tagsSummary(selected: string[]): string {
  const names = selected.map((name) => `«${name}»`).join(", ");
  return selected.length === 1 ? `с тегом ${names}` : `с тегами ${names}`;
}

export function matchesNeedle(game: { title: string; note: string }, needle: string): boolean {
  return game.title.toLowerCase().includes(needle) || game.note.toLowerCase().includes(needle);
}

export function pickerRows(catalog: TagRow[], mine: string[], forum: string[], top?: string[]): TagRow[] {
  const rows = new Map(catalog.map((row) => [row.name, row]));
  for (const name of [...mine, ...forum]) {
    if (!rows.has(name)) rows.set(name, { name, count: 0, forum: forum.includes(name) });
  }
  const checked = (name: string) => (top ? top.includes(name) : mine.includes(name) || forum.includes(name));
  return Array.from(rows.values()).sort(
    (a, b) =>
      Number(checked(b.name)) - Number(checked(a.name)) ||
      b.count - a.count ||
      a.name.localeCompare(b.name, "ru"),
  );
}

export function findTagName(rows: TagRow[], text: string): string | null {
  const key = text.trim().toLowerCase();
  if (key === "") return null;
  return rows.find((row) => row.name.toLowerCase() === key)?.name ?? null;
}
