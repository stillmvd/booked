export const GAME_CARD_MIN = 264;
export const GAME_GRID_GAP = 20;

export interface GridArea {
  gridRow: number;
  gridColumn: string;
}

export interface OpenPlacement {
  card: GridArea | null;
  panel: GridArea | null;
  spot: GridArea | null;
}

export function gridColumns(width: number): number {
  return Math.max(1, Math.floor((width + GAME_GRID_GAP) / (GAME_CARD_MIN + GAME_GRID_GAP)));
}

export function openPlacement(index: number, columns: number, count: number): OpenPlacement {
  if (index < 0 || columns < 2) return { card: null, panel: null, spot: null };
  const gridRow = Math.floor(index / columns) + 1;
  if (columns === 2) {
    return { card: { gridRow, gridColumn: "1" }, panel: { gridRow, gridColumn: "2" }, spot: null };
  }
  return {
    card: { gridRow, gridColumn: "1 / span 2" },
    panel: { gridRow, gridColumn: "3" },
    spot: columns > 3 && count > 1 ? { gridRow, gridColumn: "1 / span 3" } : null,
  };
}
