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

export function placeMenu({ anchor, size, viewport, prefer }: PlaceMenuArgs): MenuPosition {
  const normalLeft = prefer === "side" ? anchor.right : anchor.left;
  let left = normalLeft;
  if (left + size.width > viewport.width) {
    left = anchor.left - size.width;
  }
  left = Math.max(0, left);

  let top = anchor.top;
  if (top + size.height > viewport.height) {
    top = anchor.top - size.height;
  }
  top = Math.max(0, top);

  return { left, top };
}
