export interface Rect {
  top: number;
  height: number;
  left?: number;
  width?: number;
}

export function insertionIndexVertical(rects: Rect[], pointerY: number): number | null {
  if (rects.length === 0) return null;
  let index = 0;
  for (const rect of rects) {
    if (pointerY >= rect.top + rect.height / 2) index += 1;
  }
  return index;
}

const GRID_ROW_TOLERANCE = 1;

export function insertionIndexGrid(rects: Rect[], pointerX: number, pointerY: number): number | null {
  if (rects.length === 0) return null;
  const rows: { top: number; height: number; start: number; end: number }[] = [];
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.top - rect.top) <= GRID_ROW_TOLERANCE) {
      row.end = i;
      row.height = Math.max(row.height, rect.height);
    } else {
      rows.push({ top: rect.top, height: rect.height, start: i, end: i });
    }
  }
  let row = rows[rows.length - 1];
  for (const candidate of rows) {
    if (pointerY < candidate.top + candidate.height) {
      row = candidate;
      break;
    }
  }
  for (let i = row.start; i <= row.end; i++) {
    const rect = rects[i];
    const mid = (rect.left ?? 0) + (rect.width ?? 0) / 2;
    if (pointerX < mid) return i;
  }
  return row.end + 1;
}

export function reorderIds(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  const insertAt = to > from ? to - 1 : to;
  next.splice(insertAt, 0, moved);
  return next;
}
