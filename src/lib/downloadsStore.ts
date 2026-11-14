import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";

import {
  gameDownloadAdd,
  gameDownloadCancel,
  gameDownloadClaim,
  gameDownloadDismiss,
  gameDownloadDismissUnclaimed,
  gameDownloadRetry,
  gameDownloads,
} from "./api";
import { EMPTY_DOWNLOADS } from "./downloads";
import type { DownloadSnapshot } from "./types";

const DOWNLOADS_EVENT = "games:downloads";

let state: DownloadSnapshot = EMPTY_DOWNLOADS;
const listeners = new Set<() => void>();
let started = false;
let fresh = false;
let reveal = false;

function publish(next: DownloadSnapshot) {
  state = next;
  listeners.forEach((listener) => listener());
}

function start() {
  if (started) return;
  started = true;
  void listen<DownloadSnapshot>(DOWNLOADS_EVENT, (e) => {
    fresh = true;
    publish(e.payload);
  });
  gameDownloads()
    .then((snapshot) => {
      if (!fresh) publish(snapshot);
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): DownloadSnapshot {
  return state;
}

export function useDownloads(): DownloadSnapshot {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, snapshot);
}

async function apply(call: Promise<DownloadSnapshot>): Promise<void> {
  const next = await call;
  fresh = true;
  publish(next);
}

export function addDownloads(ids: number[]): Promise<void> {
  reveal = true;
  return apply(gameDownloadAdd(ids));
}

export function takeReveal(): boolean {
  const asked = reveal;
  reveal = false;
  return asked;
}

export function cancelDownload(id: number): Promise<void> {
  return apply(gameDownloadCancel(id));
}

export function claimDownload(unclaimed: number, row: number): Promise<void> {
  return apply(gameDownloadClaim(unclaimed, row));
}

export function dismissUnclaimed(unclaimed: number): Promise<void> {
  return apply(gameDownloadDismissUnclaimed(unclaimed));
}

export function retryDownload(id: number): Promise<void> {
  return apply(gameDownloadRetry(id));
}

export function dismissDownloads(): Promise<void> {
  return apply(gameDownloadDismiss());
}
