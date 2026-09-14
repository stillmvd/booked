export const FOLDER_GAP = 20;
export const FOLDER_TRACK = 168 + FOLDER_GAP;

export function visibleFolderCount(containerWidth: number, total: number): number {
  const perRow = Math.max(1, Math.floor((containerWidth + FOLDER_GAP) / FOLDER_TRACK));
  return Math.min(total, perRow * 2);
}
