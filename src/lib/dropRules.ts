import { pathTo } from "./tree.ts";
import type { FolderNode } from "./types.ts";

export interface DragItem {
  kind: "folder" | "bookmark";
  id: number;
  parentId: number | null;
}

export function isDropAllowed(args: {
  active: DragItem;
  targetFolderId: number | null;
  ancestorIds: number[];
}): boolean {
  const { active, targetFolderId, ancestorIds } = args;
  if (active.kind === "bookmark") {
    return targetFolderId !== active.parentId;
  }
  if (targetFolderId === active.id) return false;
  return !ancestorIds.includes(active.id);
}

export function isTreeDropAllowed(args: {
  active: DragItem;
  targetFolderId: number | null;
  nodes: FolderNode[];
}): boolean {
  const { active, targetFolderId, nodes } = args;
  if (targetFolderId === active.parentId) return false;
  const ancestorIds = targetFolderId === null ? [] : pathTo(nodes, targetFolderId);
  return isDropAllowed({ active, targetFolderId, ancestorIds });
}
