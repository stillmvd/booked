export const FOLDER_TRACK = 184;

export function visibleFolderCount(containerWidth: number, total: number): number {
  const perRow = Math.max(1, Math.floor((containerWidth + 16) / FOLDER_TRACK));
  return Math.min(total, perRow * 2);
}
