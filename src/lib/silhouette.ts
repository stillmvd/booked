export function silhouettePath(
  w = 168,
  h = 124,
  tabW = 74,
  tabH = 12,
  slant = 12,
  r = 14,
): string {
  const rt = Math.min(r, 7);
  const top = tabH;
  const p: string[] = [`M ${0.5 + rt} 0.5`];
  p.push(`L ${0.5 + tabW - slant} 0.5`);
  p.push(
    `C ${0.5 + tabW - slant / 2} 0.5 ` +
      `${0.5 + tabW - slant / 2} ${top + 0.5} ` +
      `${0.5 + tabW} ${top + 0.5}`,
  );
  p.push(`L ${w - 0.5 - r} ${top + 0.5}`);
  p.push(`Q ${w - 0.5} ${top + 0.5} ${w - 0.5} ${top + 0.5 + r}`);
  p.push(`L ${w - 0.5} ${h - 0.5 - r}`);
  p.push(`Q ${w - 0.5} ${h - 0.5} ${w - 0.5 - r} ${h - 0.5}`);
  p.push(`L ${0.5 + r} ${h - 0.5}`);
  p.push(`Q 0.5 ${h - 0.5} 0.5 ${h - 0.5 - r}`);
  p.push(`L 0.5 ${0.5 + rt}`);
  p.push(`Q 0.5 0.5 ${0.5 + rt} 0.5`);
  p.push("Z");
  return p.join(" ");
}

export const FOLDER_PATH = silhouettePath();
