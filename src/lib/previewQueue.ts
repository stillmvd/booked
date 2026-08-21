const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_BATCH_SIZE = 50;

export interface CreatePreviewQueueOptions {
  onFlush: (ids: number[]) => void | Promise<void>;
  debounceMs?: number;
  batchSize?: number;
}

export interface PreviewQueue {
  observe: (id: number) => void;
  unobserve: (id: number) => void;
  dispose: () => void;
}

export function createPreviewQueue(options: CreatePreviewQueueOptions): PreviewQueue {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const ready = new Set<number>();
  let disposed = false;
  let flushScheduled = false;

  function scheduleFlush(): void {
    if (disposed || flushScheduled) return;
    flushScheduled = true;
    setTimeout(runFlush, 0);
  }

  function runFlush(): void {
    flushScheduled = false;
    if (disposed || ready.size === 0) return;
    const batch = Array.from(ready).slice(0, batchSize);
    for (const id of batch) ready.delete(id);
    Promise.resolve(options.onFlush(batch)).catch((err) => console.error(err));
    if (ready.size > 0) scheduleFlush();
  }

  function observe(id: number): void {
    if (disposed || ready.has(id)) return;
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(id);
      ready.add(id);
      scheduleFlush();
    }, debounceMs);
    timers.set(id, timer);
  }

  function unobserve(id: number): void {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  function dispose(): void {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    ready.clear();
  }

  return { observe, unobserve, dispose };
}
