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
    top = (prefer === "side" ? anchor.bottom : anchor.top) - size.height;
  }
  top = Math.max(0, top);

  return { left, top };
}

export interface PlacePopoverArgs {
  anchor: Rect | null;
  size: Size;
  viewport: Size;
  gap?: number;
  margin?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function placePopover({ anchor, size, viewport, gap = 12, margin = 12 }: PlacePopoverArgs): MenuPosition {
  const maxLeft = Math.max(margin, viewport.width - margin - size.width);
  const maxTop = Math.max(margin, viewport.height - margin - size.height);
  if (!anchor) {
    return {
      left: clamp(Math.round((viewport.width - size.width) / 2), margin, maxLeft),
      top: clamp(Math.round((viewport.height - size.height) / 2), margin, maxTop),
    };
  }
  const right = anchor.right + gap;
  if (right + size.width <= viewport.width - margin) {
    return { left: right, top: clamp(anchor.top + gap, margin, maxTop) };
  }
  const left = anchor.left - gap - size.width;
  if (left >= margin) {
    return { left, top: clamp(anchor.top + gap, margin, maxTop) };
  }
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const roomBelow = viewport.height - margin - below;
  const roomAbove = anchor.top - gap - margin;
  const fitsBelow = roomBelow >= size.height;
  const top = fitsBelow || (roomBelow >= roomAbove && above < margin) ? below : above;
  return { left: clamp(anchor.left, margin, maxLeft), top: clamp(top, margin, maxTop) };
}
