export const DELETE_DELAY_MS = 5000;

interface PendingTask {
  timer: ReturnType<typeof setTimeout>;
  run: () => void | Promise<void>;
}

const pending = new Map<string, PendingTask>();
const running = new Set<Promise<void>>();

export function schedule(
  key: string,
  run: () => void | Promise<void>,
  delayMs: number = DELETE_DELAY_MS,
): void {
  cancel(key);
  const timer = setTimeout(() => {
    pending.delete(key);
    const task: Promise<void> = Promise.resolve(run())
      .catch((err) => console.error(err))
      .finally(() => running.delete(task));
    running.add(task);
  }, delayMs);
  pending.set(key, { timer, run });
}

export function cancel(key: string): boolean {
  const task = pending.get(key);
  if (!task) return false;
  clearTimeout(task.timer);
  pending.delete(key);
  return true;
}

export async function flushAll(): Promise<void> {
  const tasks = Array.from(pending.values());
  pending.clear();
  for (const task of tasks) clearTimeout(task.timer);
  await Promise.allSettled([...running, ...tasks.map((task) => task.run())]);
}

export function pendingKeys(): Set<string> {
  return new Set(pending.keys());
}
