export interface LaunchGroup<T> {
  key: string;
  label: string;
  items: T[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function midnight(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function daysAgo(launchedAt: number, now: Date): number {
  return Math.max(0, Math.round((midnight(now) - midnight(new Date(launchedAt * 1000))) / DAY_MS));
}

function weekday(launchedAt: number): string {
  const name = new Date(launchedAt * 1000).toLocaleDateString("ru", { weekday: "long" });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function bucket(launchedAt: number | null, now: Date, never: string): { key: string; order: number; label: string } {
  if (launchedAt === null) return { key: "never", order: 9, label: never };
  const days = daysAgo(launchedAt, now);
  if (days === 0) return { key: "today", order: 0, label: "Сегодня" };
  if (days === 1) return { key: "yesterday", order: 1, label: "Вчера" };
  if (days <= 6) return { key: `day-${days}`, order: days, label: weekday(launchedAt) };
  if (days <= 30) return { key: "week", order: 7, label: "Больше недели назад" };
  return { key: "month", order: 8, label: "Больше месяца назад" };
}

export function launchGroups<T extends { lastLaunchedAt: number | null }>(items: T[], now: Date): LaunchGroup<T>[] {
  return dateGroups(items, now, (item) => item.lastLaunchedAt, "Не запускал");
}

export function dateGroups<T>(
  items: T[],
  now: Date,
  at: (item: T) => number | null,
  never: string,
  oldFirst = false,
): LaunchGroup<T>[] {
  const groups = new Map<string, LaunchGroup<T> & { order: number }>();
  for (const item of items) {
    const { key, order, label } = bucket(at(item), now, never);
    const group = groups.get(key) ?? { key, order, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const sign = oldFirst ? -1 : 1;
  return [...groups.values()]
    .sort((a, b) => (a.key === "never" ? 1 : b.key === "never" ? -1 : sign * (a.order - b.order)))
    .map(({ key, label, items }) => ({
      key,
      label,
      items: items.sort((a, b) => sign * ((at(b) ?? 0) - (at(a) ?? 0))),
    }));
}
