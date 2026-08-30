export function visibleChipCount(
  containerWidth: number,
  chipWidths: number[],
  gap: number,
  moreChipWidth: number,
): number {
  const total = chipWidths.length;
  if (total === 0) return 0;

  const width = Math.max(0, containerWidth);
  const fullWidth = chipWidths.reduce((sum, w) => sum + w, 0) + gap * (total - 1);
  if (fullWidth <= width) return total;

  let running = 0;
  let visible = 0;
  for (const chipWidth of chipWidths) {
    const prefixGap = visible > 0 ? gap : 0;
    const candidate = running + prefixGap + chipWidth;
    const tailReserve = gap + moreChipWidth;
    if (visible === 0 || candidate + tailReserve <= width) {
      running = candidate;
      visible += 1;
    } else {
      break;
    }
  }
  return Math.max(1, visible);
}
