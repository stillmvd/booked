import { invoke } from "@tauri-apps/api/core";

export type GlassTheme = "dark" | "light";

const REDUCED_TRANSPARENCY_QUERY = "(prefers-reduced-transparency: reduce)";

let lastTheme: GlassTheme | null = null;
let lastKey = "";

function reducedTransparency(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia(REDUCED_TRANSPARENCY_QUERY).matches;
}

function setGlass(on: boolean): boolean {
  if (on) document.documentElement.dataset.glass = "mica";
  else delete document.documentElement.dataset.glass;
  return on;
}

export async function applyGlass(theme: GlassTheme): Promise<boolean> {
  lastTheme = theme;
  const reduced = reducedTransparency();
  const key = `${theme}:${reduced}`;
  if (key === lastKey) return document.documentElement.dataset.glass === "mica";
  lastKey = key;
  try {
    if (reduced) {
      await invoke("window_glass_clear");
      return setGlass(false);
    }
    return setGlass(await invoke<boolean>("window_glass_apply", { dark: theme === "dark" }));
  } catch (e) {
    console.error(e);
    return setGlass(false);
  }
}

export function watchGlass(): void {
  if (typeof globalThis.matchMedia !== "function") return;
  globalThis.matchMedia(REDUCED_TRANSPARENCY_QUERY).addEventListener("change", () => {
    if (lastTheme) void applyGlass(lastTheme);
  });
}
