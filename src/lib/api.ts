import { invoke } from "@tauri-apps/api/core";

import type { FolderContents } from "./types";

export function folderCreate(name: string, parentId: number | null): Promise<number> {
  return invoke("folder_create", { name, parentId });
}

export function folderChildren(parentId: number | null): Promise<FolderContents> {
  return invoke("folder_children", { parentId });
}
