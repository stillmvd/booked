export const DELETE_DELAY_MS = 5000;

interface PendingTask {
  timer: ReturnType<typeof setTimeout>;
  run: () => void | Promise<void>;
}

const pending = new Map<string, PendingTask>();

export function schedule(key: string, run: () => void | Promise<void>): void {
  cancel(key);
  const timer = setTimeout(() => {
    pending.delete(key);
    Promise.resolve(run()).catch((err) => console.error(err));
  }, DELETE_DELAY_MS);
  pending.set(key, { timer, run });
}

export function cancel(key: string): void {
  const task = pending.get(key);
  if (!task) return;
  clearTimeout(task.timer);
  pending.delete(key);
}

export async function flushAll(): Promise<void> {
  const tasks = Array.from(pending.values());
  pending.clear();
  for (const task of tasks) clearTimeout(task.timer);
  await Promise.allSettled(tasks.map((task) => task.run()));
}

export function pendingKeys(): Set<string> {
  return new Set(pending.keys());
}
