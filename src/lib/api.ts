import { invoke } from "@tauri-apps/api/core";

import type { Crumb, FolderContents } from "./types";

export function folderCreate(name: string, parentId: number | null): Promise<number> {
  return invoke("folder_create", { name, parentId });
}

export function folderChildren(parentId: number | null): Promise<FolderContents> {
  return invoke("folder_children", { parentId });
}

export function folderBreadcrumbs(id: number): Promise<Crumb[]> {
  return invoke("folder_breadcrumbs", { id });
}

export function folderMove(id: number, newParentId: number | null): Promise<void> {
  return invoke("folder_move", { id, newParent: newParentId });
}
