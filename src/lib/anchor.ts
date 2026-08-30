export interface ItemTop {
  id: string;
  top: number;
}

export interface Anchor {
  id: string;
  delta: number;
}

export function pickAnchor(items: ItemTop[], containerTop: number): Anchor | null {
  for (const item of items) {
    if (item.top >= containerTop - 1) {
      return { id: item.id, delta: item.top - containerTop };
    }
  }
  return null;
}

export const TOP_BOUNDARY = "top-boundary" as const;

export function nextIndex(
  key: string,
  current: number,
  count: number,
  columns: number,
  pageStep: number,
): number | typeof TOP_BOUNDARY | null {
  if (count === 0) return null;

  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return Math.min(count - 1, current + pageStep);
    case "PageUp":
      return Math.max(0, current - pageStep);
    case "ArrowRight": {
      const next = current + 1;
      return next >= 0 && next < count ? next : null;
    }
    case "ArrowLeft": {
      const next = current - 1;
      return next >= 0 && next < count ? next : null;
    }
    case "ArrowDown": {
      const next = current + columns;
      return next >= 0 && next < count ? next : null;
    }
    case "ArrowUp": {
      const next = current - columns;
      return next >= 0 && next < count ? next : TOP_BOUNDARY;
    }
    default:
      return null;
  }
}
