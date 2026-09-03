import type { ResolvedTheme } from "./theme";

const DARK: ReadonlyArray<readonly [string, string]> = [
  ["#2a2a2e", "#b9bac2"],
  ["#232326", "#a8a9b1"],
  ["#26262a", "#afb0b8"],
  ["#2d2a2a", "#c0b4b4"],
  ["#282a28", "#b2b8b0"],
  ["#2b2926", "#bdb6ac"],
  ["#2c2c31", "#b4b5bd"],
  ["#252528", "#abacb4"],
];

const LIGHT: ReadonlyArray<readonly [string, string]> = [
  ["#e6e6ea", "#4f5058"],
  ["#ececef", "#57585f"],
  ["#e9e9ec", "#525359"],
  ["#ebe7e7", "#5a5252"],
  ["#e7e9e7", "#515651"],
  ["#eae8e4", "#585349"],
  ["#e5e5e9", "#4e4f57"],
  ["#eeeef0", "#5b5c63"],
];

const TINT_DARK: ReadonlyArray<readonly [string, string]> = [
  ["#243447", "#93bdec"],
  ["#2c2a3e", "#b5aee8"],
  ["#22333b", "#8fc7ce"],
  ["#3a2a2e", "#e3a3a8"],
  ["#2b3324", "#afc98d"],
  ["#38302a", "#d9b48d"],
  ["#26303c", "#9eb4cc"],
  ["#2e2937", "#bba9d6"],
];

const TINT_LIGHT: ReadonlyArray<readonly [string, string]> = [
  ["#dce8f7", "#28527f"],
  ["#e5e1f7", "#463c82"],
  ["#dcecee", "#25585e"],
  ["#f6e0e2", "#7b3239"],
  ["#e6efd8", "#3f5220"],
  ["#f2e7d8", "#6b4a22"],
  ["#e2e9f1", "#33495f"],
  ["#eae3f2", "#4b3868"],
];

export function hostOf(url: string): string {
  try {
    const host = new URL(url).host;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

export function plateIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h % DARK.length;
}

export function plate(seed: string, theme: ResolvedTheme): { bg: string; fg: string } {
  const [bg, fg] = (theme === "light" ? LIGHT : DARK)[plateIndex(seed)];
  return { bg, fg };
}

export function tint(seed: string, theme: ResolvedTheme): { bg: string; fg: string } {
  const [bg, fg] = (theme === "light" ? TINT_LIGHT : TINT_DARK)[plateIndex(seed)];
  return { bg, fg };
}
