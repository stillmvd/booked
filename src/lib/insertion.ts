export interface Rect {
  top: number;
  height: number;
}

export function insertionIndexVertical(rects: Rect[], pointerY: number): number | null {
  if (rects.length === 0) return null;
  let index = 0;
  for (const rect of rects) {
    if (pointerY >= rect.top + rect.height / 2) index += 1;
  }
  return index;
}

export function reorderIds(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  const insertAt = to > from ? to - 1 : to;
  next.splice(insertAt, 0, moved);
  return next;
}
