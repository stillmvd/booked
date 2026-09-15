import { pluralizeRu } from "./pluralizeRu.ts";
import type { BrowserEntry, BrowserTarget } from "./types.ts";

export const NONE_TARGET: BrowserTarget = { browser: null, profile: null, profileName: null };

export function browserKeyOf(name: string): string {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join("-");
}

export function targetsMatch(a: BrowserTarget, b: BrowserTarget): boolean {
  if (!a.browser || !b.browser) return false;
  return browserKeyOf(a.browser) === browserKeyOf(b.browser) && (a.profile ?? null) === (b.profile ?? null);
}

export function selectedEntryIndex(entries: readonly BrowserEntry[], value: BrowserTarget): number {
  if (!value.browser) return -1;
  const key = browserKeyOf(value.browser);
  return entries.findIndex((entry) => entry.key === key);
}

export function profileTargets(entry: BrowserEntry): BrowserTarget[] {
  return [
    { browser: entry.name, profile: null, profileName: null },
    ...entry.profiles.map((profile) => ({ browser: entry.name, profile: profile.key, profileName: profile.name })),
  ];
}

export function selectedProfileIndex(entry: BrowserEntry, value: BrowserTarget): number {
  return profileTargets(entry).findIndex((target) => targetsMatch(target, value));
}

export function radioStep(key: string, index: number, length: number): number | null {
  if (length === 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(length - 1, index + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

export function browserCaption(entries: readonly BrowserEntry[], value: BrowserTarget): { name: string; sub: string } {
  if (!value.browser) return { name: "Без назначения", sub: "Как обычно" };
  const entry = entries[selectedEntryIndex(entries, value)];
  if (!entry) {
    return {
      name: value.profileName ? `${value.browser} · ${value.profileName}` : value.browser,
      sub: "Не найден на этом компьютере",
    };
  }
  const count = entry.profiles.length;
  return {
    name: entry.name,
    sub: count === 0 ? "Без профилей" : `${count} ${pluralizeRu(count, ["профиль", "профиля", "профилей"])}`,
  };
}
