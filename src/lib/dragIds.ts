export const BAND_MORE_DROP_ID = "band-more";
export const SPRING_LOAD_MS = 300;

const FOLDER_DRAG_PREFIX = "folder-";
const TREE_DROP_PREFIX = "tree-";
const TREE_ROOT_DROP_ID = "tree-root";

export function folderDragId(id: number): string {
  return FOLDER_DRAG_PREFIX + id;
}

export function isFolderDragId(id: string | number): id is string {
  return typeof id === "string" && id.startsWith(FOLDER_DRAG_PREFIX);
}

export function folderIdFromDragId(id: string): number {
  return Number(id.slice(FOLDER_DRAG_PREFIX.length));
}

export function treeDropId(folderId: number | null): string {
  return folderId === null ? TREE_ROOT_DROP_ID : TREE_DROP_PREFIX + folderId;
}

export function isTreeDropId(id: string | number): id is string {
  return typeof id === "string" && id.startsWith(TREE_DROP_PREFIX);
}

export function folderIdFromTreeDropId(id: string): number | null {
  return id === TREE_ROOT_DROP_ID ? null : Number(id.slice(TREE_DROP_PREFIX.length));
}
