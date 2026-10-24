export type OrderKey = "name" | "launch" | "added" | "rating";

export interface Order {
  key: OrderKey;
  flip: boolean;
}

export type RateFilter = number | "none" | null;

export const LIBRARY_ORDERS: OrderKey[] = ["name", "launch", "added", "rating"];
export const WISH_ORDERS: OrderKey[] = ["name", "added"];

export const ORDER_LABELS: Record<OrderKey, string> = {
  name: "Название",
  launch: "Дата запуска",
  added: "Дата добавления",
  rating: "Оценка",
};

export const ORDER_DIRECTIONS: Record<OrderKey, [string, string]> = {
  name: ["От А до Я", "От Я до А"],
  launch: ["Сначала новые", "Сначала старые"],
  added: ["Сначала новые", "Сначала старые"],
  rating: ["Сначала высокие", "Сначала низкие"],
};

export function storedOrder(raw: unknown, legacyGrouped: unknown, legacyKey: OrderKey, allowed: OrderKey[]): Order {
  if (raw !== null && typeof raw === "object") {
    const { key, flip } = raw as Partial<Order>;
    if (key && allowed.includes(key)) return { key, flip: flip === true };
  }
  return { key: legacyGrouped === true ? legacyKey : "name", flip: false };
}

export function nextOrder(current: Order, key: OrderKey): Order {
  return current.key === key ? { key, flip: !current.flip } : { key, flip: false };
}

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

export function compareTitles(a: string, b: string): number {
  return collator.compare(a, b);
}

export function sortGames<T extends { title: string; rating: number }>(items: readonly T[], order: Order): T[] {
  const sign = order.flip ? -1 : 1;
  if (order.key === "rating") {
    return [...items].sort((a, b) => sign * (b.rating - a.rating) || compareTitles(a.title, b.title));
  }
  return [...items].sort((a, b) => sign * compareTitles(a.title, b.title));
}

export function matchesRate(rating: number, rate: RateFilter): boolean {
  if (rate === null) return true;
  return rate === "none" ? rating === 0 : rating >= rate;
}

export function engineCounts(items: readonly { engine: string | null }[], selected: string | null): [string, number][] {
  const counts = new Map<string, number>();
  items.forEach(({ engine }) => {
    if (engine) counts.set(engine, (counts.get(engine) ?? 0) + 1);
  });
  if (selected && !counts.has(selected)) counts.set(selected, 0);
  return [...counts].sort((a, b) => b[1] - a[1] || compareTitles(a[0], b[0]));
}
