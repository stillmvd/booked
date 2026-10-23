import { listen } from "@tauri-apps/api/event";

import { gameImport, gameImportCancel, type GameImported } from "./api";
import { loadGames } from "./gamesStore";
import { readStored, writeStored } from "./storage";
import { userMessage } from "./userMessage";

const IMPORT_PROGRESS_EVENT = "games:import-progress";
const PAGE_ASK_KEY = "booked.games.pageAsk";
const DONE_SHOWN_MS = 5000;

export interface ImportTarget {
  id: number;
  update: boolean;
}

export interface ImportJob {
  key: number;
  path: string;
  target: ImportTarget | null;
  done: number;
  total: number;
  phase: "running" | "done" | "error";
  id: number | null;
  error: string | null;
}

export interface ImportResult {
  id: number;
  target: ImportTarget | null;
  similar: GameImported["similar"];
}

interface ImportState {
  job: ImportJob | null;
  result: ImportResult | null;
  pageAsk: number[];
  later: number[];
}

let state: ImportState = { job: null, result: null, pageAsk: readStored<number[]>(PAGE_ASK_KEY, []), later: [] };
const listeners = new Set<() => void>();
let listening = false;
let lastKey = 0;
let inFlight = false;

function update(change: Partial<ImportState>) {
  state = { ...state, ...change };
  if ("pageAsk" in change) writeStored(PAGE_ASK_KEY, state.pageAsk);
  listeners.forEach((listener) => listener());
}

function patchJob(key: number, change: Partial<ImportJob>) {
  if (state.job?.key === key) update({ job: { ...state.job, ...change } });
}

export function subscribeImport(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function importState(): ImportState {
  return state;
}

export function importRunning(): boolean {
  return inFlight || state.job?.phase === "running";
}

export function startImport(path: string, target: ImportTarget | null): string | null {
  if (importRunning()) return "Уже добавляется другая игра — дождитесь конца.";
  if (!listening) {
    listening = true;
    void listen<{ done: number; total: number }>(IMPORT_PROGRESS_EVENT, (e) => {
      const job = state.job;
      if (job?.phase === "running") patchJob(job.key, { done: e.payload.done, total: e.payload.total });
    });
  }
  const key = ++lastKey;
  inFlight = true;
  update({ job: { key, path, target, done: 0, total: 0, phase: "running", id: null, error: null }, result: null });
  gameImport(path, target && !target.update ? target.id : null)
    .then(async ({ id, similar }) => {
      const library = await loadGames().catch(() => null);
      const game = library?.games.find((item) => item.id === id);
      const askPage = !target && game && game.pageUrl === null && !state.pageAsk.includes(id);
      update({
        result: { id, target, similar: target ? null : similar },
        ...(askPage ? { pageAsk: [...state.pageAsk, id] } : {}),
      });
      patchJob(key, { phase: "done", id });
      setTimeout(() => {
        if (state.job?.key === key) update({ job: null });
      }, DONE_SHOWN_MS);
    })
    .catch((err) => patchJob(key, { phase: "error", error: userMessage(err) }))
    .finally(() => {
      inFlight = false;
    });
  return null;
}

export function dismissImport() {
  const job = state.job;
  if (!job) return;
  update({ job: null });
  if (job.phase === "running") gameImportCancel().catch(() => undefined);
}

export function takeImportResult(): ImportResult | null {
  const result = state.result;
  if (result) update({ result: null });
  return result;
}

export function askPageLater(id: number) {
  update({ later: [...state.later, id] });
}

export function forgetPageAsk(id: number) {
  update({ pageAsk: state.pageAsk.filter((item) => item !== id) });
}
