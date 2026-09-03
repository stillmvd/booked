export const EDGE_ZONE_PX = 20;
export const EDGE_STEP_PX = 6;

export function edgeScrollStep(y: number, top: number, bottom: number): number {
  if (y < top || y > bottom) return 0;
  if (y < top + EDGE_ZONE_PX) return -EDGE_STEP_PX;
  if (y > bottom - EDGE_ZONE_PX) return EDGE_STEP_PX;
  return 0;
}
