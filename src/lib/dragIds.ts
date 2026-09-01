export const BAND_MORE_DROP_ID = "band-more";

const FOLDER_DRAG_PREFIX = "folder-";

export function folderDragId(id: number): string {
  return FOLDER_DRAG_PREFIX + id;
}

export function isFolderDragId(id: string | number): id is string {
  return typeof id === "string" && id.startsWith(FOLDER_DRAG_PREFIX);
}

export function folderIdFromDragId(id: string): number {
  return Number(id.slice(FOLDER_DRAG_PREFIX.length));
}
