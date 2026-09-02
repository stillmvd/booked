import { useEffect, useState } from "react";

import type { Theme } from "./types";

export type ResolvedTheme = "dark" | "light";

const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(pref: Theme, systemDark: boolean): ResolvedTheme {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

export function systemPrefersDark(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia(PREFERS_DARK_QUERY).matches;
}

export function onSystemThemeChange(cb: (dark: boolean) => void): () => void {
  if (typeof globalThis.matchMedia !== "function") return () => {};
  const mql = globalThis.matchMedia(PREFERS_DARK_QUERY);
  const handler = (e: MediaQueryListEvent) => cb(e.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

export function useTheme(pref: Theme): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(systemPrefersDark());
  useEffect(() => onSystemThemeChange(setSystemDark), []);
  return resolveTheme(pref, systemDark);
}
