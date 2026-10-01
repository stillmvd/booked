import { convertFileSrc } from "@tauri-apps/api/core";

import { markThumbReady, mediaPath, thumbsState, thumbStore } from "./api";

const THUMB_WIDTH = 640;
const THUMB_QUALITY = 0.85;

let missing: string[] = [];
let running = false;
let again = false;
const failed = new Set<string>();

export async function loadThumbs(): Promise<void> {
  const state = await thumbsState();
  state.ready.forEach(markThumbReady);
  missing = state.missing;
}

async function makeThumb(rel: string) {
  const response = await fetch(convertFileSrc(await mediaPath(rel.split("/"))));
  const source = await createImageBitmap(await response.blob());
  const scale = Math.min(1, THUMB_WIDTH / source.width);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  source.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: THUMB_QUALITY });
  await thumbStore(rel, new Uint8Array(await blob.arrayBuffer()));
  markThumbReady(rel);
}

const idle = () => new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 2000 }));

export async function backfillThumbs(refresh = false) {
  if (running) {
    again = again || refresh;
    return;
  }
  running = true;
  try {
    if (refresh) await loadThumbs();
    const queue = missing;
    missing = [];
    for (const rel of queue) {
      if (failed.has(rel)) continue;
      await idle();
      await makeThumb(rel).catch(() => failed.add(rel));
    }
  } finally {
    running = false;
  }
  if (again) {
    again = false;
    await backfillThumbs(true);
  }
}
