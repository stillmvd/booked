import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import { gamesRunning } from "./api";
import type { GameRunPhase, GameRunState } from "./types";

export interface GameRun {
  phase: GameRunPhase;
  startedAt: number;
}

type Runs = ReadonlyMap<number, GameRun>;

let current: Runs = new Map();
const listeners = new Set<() => void>();
let watching = false;

function apply(state: GameRunState) {
  const next = new Map(current);
  if (state.phase) next.set(state.id, { phase: state.phase, startedAt: state.startedAt });
  else next.delete(state.id);
  current = next;
  listeners.forEach((listener) => listener());
}

function watch() {
  if (watching) return;
  watching = true;
  const heard = new Set<number>();
  void listen<GameRunState>("games:run", (event) => {
    heard.add(event.payload.id);
    apply(event.payload);
  })
    .then(() => gamesRunning())
    .then((list) => list.filter((state) => !heard.has(state.id)).forEach(apply))
    .catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useGameRuns(): Runs {
  return useSyncExternalStore(subscribe, () => current);
}
