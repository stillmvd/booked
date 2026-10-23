import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import { armAll, arrive, dismiss, gameEnded, type RateAsk } from "./rateOffer";
import type { GameRunState } from "./types";

let current: readonly RateAsk[] = [];
const listeners = new Set<() => void>();
let watching = false;

function set(next: readonly RateAsk[]) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function watch() {
  if (watching) return;
  watching = true;
  void listen<{ id: number; startedAt: number }>("games:rate-ask", (event) => {
    set(arrive(current, event.payload.id, event.payload.startedAt, document.hasFocus(), Date.now()));
  });
  void listen<GameRunState>("games:run", (event) => {
    if (event.payload.phase === null) set(gameEnded(current, event.payload.id, Date.now()));
  });
  window.addEventListener("focus", () => set(armAll(current)));
}

function subscribe(listener: () => void): () => void {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRateAsks(): readonly RateAsk[] {
  return useSyncExternalStore(subscribe, () => current);
}

export function dismissRateAsk(id: number) {
  set(dismiss(current, id));
}
