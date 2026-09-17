import { pluralizeRu } from "./pluralizeRu.ts";
import type { TagTarget, TagUsage } from "./types.ts";

export type TagSort = "frequency" | "alpha";

export const TAG_SORT_KEY = "booked.tags.sort";

export function normalizeTag(name: string): string {
  return name.trim().toLowerCase();
}

export function usageTotal(tag: TagUsage): number {
  return tag.bookmarks + tag.folders + tag.games;
}

function byName(a: TagUsage, b: TagUsage): number {
  return a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
}

export function sortTags(tags: TagUsage[], sort: TagSort): TagUsage[] {
  const sorted = [...tags];
  return sort === "alpha"
    ? sorted.sort(byName)
    : sorted.sort((a, b) => usageTotal(b) - usageTotal(a) || byName(a, b));
}

export function filterTags(tags: TagUsage[], query: string): TagUsage[] {
  const needle = normalizeTag(query);
  return needle ? tags.filter((tag) => tag.name.toLowerCase().includes(needle)) : tags;
}

export function findTag(tags: TagUsage[], name: string): TagUsage | undefined {
  const key = normalizeTag(name);
  return key ? tags.find((tag) => normalizeTag(tag.name) === key) : undefined;
}

export function mergeInto(tags: TagUsage[], from: string, to: string): TagUsage | null {
  const found = findTag(tags, to);
  return found && normalizeTag(found.name) !== normalizeTag(from) ? found : null;
}

type Forms = [string, string, string];

const NOMINATIVE: Forms[] = [
  ["закладка", "закладки", "закладок"],
  ["папка", "папки", "папок"],
  ["игра", "игры", "игр"],
];

const GENITIVE: Forms[] = [
  ["закладки", "закладок", "закладок"],
  ["папки", "папок", "папок"],
  ["игры", "игр", "игр"],
];

function parts(tag: TagUsage, forms: Forms[]): string[] {
  return [tag.bookmarks, tag.folders, tag.games]
    .map((n, i) => (n > 0 ? `${n} ${pluralizeRu(n, forms[i])}` : ""))
    .filter(Boolean);
}

export function usageText(tag: TagUsage): string {
  const list = parts(tag, NOMINATIVE);
  return list.length > 0 ? list.join(" · ") : "не используется";
}

export function usageFrom(tag: TagUsage): string {
  const list = parts(tag, GENITIVE);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} и ${list[list.length - 1]}` : (list[0] ?? "");
}

export function mergeText(from: TagUsage, into: TagUsage): string {
  const cards = usageTotal(into);
  return `у тегов ${usageTotal(from)} и ${cards} ${pluralizeRu(cards, ["карточка", "карточки", "карточек"])}`;
}

export function targetWord(target: TagTarget): { of: string; back: string } {
  if (target.kind === "folder") return { of: "папки", back: "К папке" };
  if (target.kind === "game") return { of: "игры", back: "К игре" };
  return { of: "закладки", back: "К закладке" };
}

export function renameSelected(selected: string[], from: string, to: string): string[] {
  const keys = new Set([normalizeTag(from), normalizeTag(to)]);
  const at = selected.findIndex((name) => keys.has(normalizeTag(name)));
  if (at < 0) return selected;
  const kept = selected.filter((name) => !keys.has(normalizeTag(name)));
  kept.splice(Math.min(at, kept.length), 0, to);
  return kept;
}

export function dropSelected(selected: string[], name: string): string[] {
  const key = normalizeTag(name);
  const next = selected.filter((tag) => normalizeTag(tag) !== key);
  return next.length === selected.length ? selected : next;
}

export function tagsSummary(tags: TagUsage[]): string {
  if (tags.length === 0) return "Тегов пока нет";
  const unused = tags.filter((tag) => usageTotal(tag) === 0).length;
  const count = `${tags.length} ${pluralizeRu(tags.length, ["тег", "тега", "тегов"])}`;
  return unused > 0 ? `${count} · ${unused} ${pluralizeRu(unused, ["нигде не стоит", "нигде не стоят", "нигде не стоят"])}` : count;
}
