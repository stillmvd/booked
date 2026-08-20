export function hostOf(url: string): string {
  try {
    const host = new URL(url).host;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

export function plate(seed: string): { bg: string; fg: string; hue: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  const hue = 186 + (h % 116);
  return {
    bg: `hsl(${hue} 20% 20%)`,
    fg: `hsl(${hue} 28% 62%)`,
    hue,
  };
}
