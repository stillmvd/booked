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
