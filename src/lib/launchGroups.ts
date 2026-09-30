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

function bucket(launchedAt: number | null, now: Date): { key: string; order: number; label: string } {
  if (launchedAt === null) return { key: "never", order: 9, label: "Не запускал" };
  const days = daysAgo(launchedAt, now);
  if (days === 0) return { key: "today", order: 0, label: "Сегодня" };
  if (days === 1) return { key: "yesterday", order: 1, label: "Вчера" };
  if (days <= 6) return { key: `day-${days}`, order: days, label: weekday(launchedAt) };
  if (days <= 30) return { key: "week", order: 7, label: "Больше недели назад" };
  return { key: "month", order: 8, label: "Больше месяца назад" };
}

export function launchGroups<T extends { lastLaunchedAt: number | null }>(items: T[], now: Date): LaunchGroup<T>[] {
  const groups = new Map<string, LaunchGroup<T> & { order: number }>();
  for (const item of items) {
    const { key, order, label } = bucket(item.lastLaunchedAt, now);
    const group = groups.get(key) ?? { key, order, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ key, label, items }) => ({
      key,
      label,
      items: items.sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0)),
    }));
}
