export interface Overflow {
  x: number;
  y: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_KEY_STEP = 1.25;
const WHEEL_ZOOM_RATE = 0.0015;

export function coverSize(
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number,
): Box {
  if (frameWidth <= 0 || frameHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

export function coverOverflow(
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number,
  zoom = 1,
): Overflow {
  const cover = coverSize(frameWidth, frameHeight, imageWidth, imageHeight);
  if (cover.width <= 0) return { x: 0, y: 0 };
  const z = clampZoom(zoom);
  return {
    x: Math.max(0, cover.width * z - frameWidth),
    y: Math.max(0, cover.height * z - frameHeight),
  };
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  if (!Number.isFinite(px)) return clampZoom(zoom);
  return clampZoom(clampZoom(zoom) * Math.exp(-px * WHEEL_ZOOM_RATE));
}

export function zoomAround(
  percent: number,
  zoom: number,
  nextZoom: number,
  frameSize: number,
  coverLength: number,
): number {
  const room = zoom * coverLength - frameSize;
  const nextRoom = nextZoom * coverLength - frameSize;
  if (nextRoom <= 0 || coverLength <= 0) return clampPercent(percent);
  const center = (Math.max(0, room) * clampPercent(percent)) / 100 + frameSize / 2;
  const share = center / (zoom * coverLength);
  return clampPercent(((share * nextZoom * coverLength - frameSize / 2) / nextRoom) * 100);
}

export interface CoverStyle {
  objectPosition: string;
  transform?: string;
  transformOrigin?: string;
}

export function coverStyle(x: number, y: number, zoom = 1): CoverStyle {
  const position = positionStyle(x, y);
  const z = clampZoom(zoom);
  if (z === ZOOM_MIN) return { objectPosition: position };
  return { objectPosition: position, transform: `scale(${z})`, transformOrigin: position };
}

export function backgroundCoverStyle(
  x: number,
  y: number,
  zoom = 1,
): { backgroundPosition: string; transform?: string; transformOrigin?: string } {
  const { objectPosition, ...scale } = coverStyle(x, y, zoom);
  return { backgroundPosition: objectPosition, ...scale };
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
