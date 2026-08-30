export const HIGHLIGHT_OPEN = "";
export const HIGHLIGHT_CLOSE = "";

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

export function splitHighlighted(text: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let rest = text;
  while (rest.length > 0) {
    const openIdx = rest.indexOf(HIGHLIGHT_OPEN);
    if (openIdx === -1) {
      segments.push({ text: rest, highlighted: false });
      break;
    }
    if (openIdx > 0) {
      segments.push({ text: rest.slice(0, openIdx), highlighted: false });
    }
    const afterOpen = rest.slice(openIdx + 1);
    const closeIdx = afterOpen.indexOf(HIGHLIGHT_CLOSE);
    if (closeIdx === -1) {
      if (afterOpen.length > 0) segments.push({ text: afterOpen, highlighted: false });
      break;
    }
    if (closeIdx > 0) {
      segments.push({ text: afterOpen.slice(0, closeIdx), highlighted: true });
    }
    rest = afterOpen.slice(closeIdx + 1);
  }
  return segments;
}
