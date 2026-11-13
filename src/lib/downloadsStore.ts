import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";

import {
  gameDownloadAdd,
  gameDownloadCancel,
  gameDownloadDismiss,
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
  return apply(gameDownloadAdd(ids));
}

export function cancelDownload(id: number): Promise<void> {
  return apply(gameDownloadCancel(id));
}

export function retryDownload(id: number): Promise<void> {
  return apply(gameDownloadRetry(id));
}

export function dismissDownloads(): Promise<void> {
  return apply(gameDownloadDismiss());
}
