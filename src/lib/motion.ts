import { useEffect, useState } from "react";

export interface DurationTable {
  hover: number;
  enter: number;
  exit: number;
  flip: number;
  nav: number;
  sheetIn: number;
  sheetOut: number;
  dragReturn: number;
}

export const DUR: DurationTable = {
  hover: 100,
  enter: 160,
  exit: 120,
  flip: 200,
  nav: 200,
  sheetIn: 200,
  sheetOut: 150,
  dragReturn: 180,
};

export const DUR_REDUCED: DurationTable = {
  hover: DUR.hover,
  enter: 100,
  exit: 80,
  flip: 120,
  nav: 120,
  sheetIn: 120,
  sheetOut: 90,
  dragReturn: DUR.dragReturn,
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function onReducedMotionChange(cb: (reduced: boolean) => void): () => void {
  if (typeof globalThis.matchMedia !== "function") return () => {};
  const mql = globalThis.matchMedia(REDUCED_MOTION_QUERY);
  const handler = (e: MediaQueryListEvent) => cb(e.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion());
  useEffect(() => onReducedMotionChange(setReduced), []);
  return reduced;
}

export function durations(reduced: boolean): DurationTable {
  return reduced ? DUR_REDUCED : DUR;
}
