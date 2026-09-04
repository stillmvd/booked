export interface NavHistory<T> {
  entries: T[];
  index: number;
}

export function createHistory<T>(start: T): NavHistory<T> {
  return { entries: [start], index: 0 };
}

export function current<T>(h: NavHistory<T>): T {
  return h.entries[h.index];
}

export function visit<T>(h: NavHistory<T>, id: T): NavHistory<T> {
  if (current(h) === id) return h;
  return { entries: [...h.entries.slice(0, h.index + 1), id], index: h.index + 1 };
}

export function canGoBack<T>(h: NavHistory<T>): boolean {
  return h.index > 0;
}

export function canGoForward<T>(h: NavHistory<T>): boolean {
  return h.index < h.entries.length - 1;
}

export function goBack<T>(h: NavHistory<T>): NavHistory<T> {
  return canGoBack(h) ? { ...h, index: h.index - 1 } : h;
}

export function goForward<T>(h: NavHistory<T>): NavHistory<T> {
  return canGoForward(h) ? { ...h, index: h.index + 1 } : h;
}

export type NavDirection = "back" | "forward";

export function navDirectionOfMouse(button: number): NavDirection | null {
  if (button === 3) return "back";
  if (button === 4) return "forward";
  return null;
}

export function navDirectionOfKey(key: string, altKey: boolean): NavDirection | null {
  if (!altKey) return null;
  if (key === "ArrowLeft") return "back";
  if (key === "ArrowRight") return "forward";
  return null;
}
