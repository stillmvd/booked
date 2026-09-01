export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Placement = "point" | "side";

export interface PlaceMenuArgs {
  anchor: Rect;
  size: Size;
  viewport: Size;
  prefer: Placement;
}

export interface MenuPosition {
  left: number;
  top: number;
}

export function placeMenu(_args: PlaceMenuArgs): MenuPosition {
  throw new Error("not implemented");
}
