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

export interface Box {
  width: number;
  height: number;
}

export function frameWindow(shownWidth: number, shownHeight: number, ratio: number): Box {
  if (shownWidth <= 0 || shownHeight <= 0 || ratio <= 0) return { width: 0, height: 0 };
  const byWidth = shownWidth / ratio;
  if (byWidth <= shownHeight) return { width: shownWidth, height: byWidth };
  return { width: shownHeight * ratio, height: shownHeight };
}

export function windowOffset(shownSize: number, windowSize: number, percent: number): number {
  const room = Math.max(0, shownSize - windowSize);
  return (room * clampPercent(percent)) / 100;
}

export function percentFromOffset(shownSize: number, windowSize: number, offset: number): number {
  const room = shownSize - windowSize;
  if (room <= 0) return 50;
  return clampPercent((offset / room) * 100);
}
