import { listen } from "@tauri-apps/api/event";

import { gamesLibrary } from "./api";
import { reuseLibrary } from "./reuse";
import type { GamesLibrary } from "./types";

type Listener = (library: GamesLibrary) => void;

let current: GamesLibrary | null = null;
const listeners = new Set<Listener>();
let watching = false;
let running: Promise<GamesLibrary> | null = null;
let queued: Promise<GamesLibrary> | null = null;
let seq = 0;
let lastDirect = 0;

export function gamesSnapshot(): GamesLibrary | null {
  return current;
}

export function rememberGames(library: GamesLibrary) {
  current = library;
}

function publish(library: GamesLibrary): GamesLibrary {
  const next = reuseLibrary(current, library);
  current = next;
  listeners.forEach((listener) => listener(next));
  return next;
}

export function publishGames(library: GamesLibrary): GamesLibrary {
  lastDirect = ++seq;
  return publish(library);
}

export function loadGames(): Promise<GamesLibrary> {
  if (!running) {
    const id = ++seq;
    running = gamesLibrary()
      .then((library) => (id < lastDirect && current ? current : publish(library)))
      .finally(() => {
        running = null;
      });
    return running;
  }
  if (!queued) {
    queued = running
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return loadGames();
      });
  }
  return queued;
}

export function subscribeGames(listener: Listener): () => void {
  listeners.add(listener);
  if (!watching) {
    watching = true;
    void listen("games:changed", () => {
      loadGames().catch(() => undefined);
    });
  }
  return () => {
    listeners.delete(listener);
  };
}
