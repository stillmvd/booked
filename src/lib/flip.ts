export interface RectLike {
  top: number;
  left: number;
}

export interface Shift {
  id: string;
  dx: number;
  dy: number;
}

export function computeShifts(before: Map<string, RectLike>, after: Map<string, RectLike>): Shift[] {
  const shifts: Shift[] = [];
  for (const [id, afterRect] of after) {
    const beforeRect = before.get(id);
    if (!beforeRect) continue;
    const dx = beforeRect.left - afterRect.left;
    const dy = beforeRect.top - afterRect.top;
    if (dx === 0 && dy === 0) continue;
    shifts.push({ id, dx, dy });
  }
  return shifts;
}

export function staggerDelay(index: number, cap: number, step: number): number {
  return index < cap ? index * step : 0;
}
