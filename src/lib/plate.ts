import type { ResolvedTheme } from "./theme";

export function hostOf(url: string): string {
  try {
    const host = new URL(url).host;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

export function plate(seed: string, theme: ResolvedTheme): { bg: string; fg: string; hue: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  const hue = 186 + (h % 116);
  return theme === "light"
    ? { bg: `hsl(${hue} 30% 91%)`, fg: `hsl(${hue} 42% 36%)`, hue }
    : { bg: `hsl(${hue} 20% 20%)`, fg: `hsl(${hue} 28% 62%)`, hue };
}
