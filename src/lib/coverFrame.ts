export interface Overflow {
  x: number;
  y: number;
}

export function coverOverflow(
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number,
): Overflow {
  if (frameWidth <= 0 || frameHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0 };
  }
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  return {
    x: Math.max(0, imageWidth * scale - frameWidth),
    y: Math.max(0, imageHeight * scale - frameHeight),
  };
}

export function shiftPercent(start: number, deltaPx: number, overflowPx: number): number {
  if (!Number.isFinite(start)) return 50;
  if (overflowPx <= 0 || !Number.isFinite(deltaPx)) return clampPercent(start);
  return clampPercent(start - (deltaPx / overflowPx) * 100);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

export function positionStyle(x: number, y: number): string {
  return `${clampPercent(x)}% ${clampPercent(y)}%`;
}
