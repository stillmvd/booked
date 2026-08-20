import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir, join } from "@tauri-apps/api/path";

import type {
  ContentsCount,
  Crumb,
  DbStatus,
  DeleteMode,
  DuplicateHit,
  FolderContents,
  FolderRef,
  ViewState,
} from "./types";

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

export function folderUpdate(
  id: number,
  name: string,
  description: string | null,
  image: string | null,
  tags: string[],
): Promise<void> {
  return invoke("folder_update", { id, name, description, image, tags });
}

export function folderListAll(): Promise<FolderRef[]> {
  return invoke("folder_list_all");
}

export function folderContentsCount(id: number): Promise<ContentsCount> {
  return invoke("folder_contents_count", { id });
}

export function folderDelete(id: number, mode: DeleteMode): Promise<void> {
  return invoke("folder_delete", { id, mode });
}

export function tagList(): Promise<string[]> {
  return invoke("tag_list");
}

export function imageImport(source: string): Promise<string> {
  return invoke("image_import", { source });
}

export async function imagePath(filename: string): Promise<string> {
  const dir = await appLocalDataDir();
  return join(dir, "images", filename);
}

export function bookmarkCreate(
  folderId: number | null,
  title: string,
  url: string,
  description: string | null,
  image: string | null,
): Promise<number> {
  return invoke("bookmark_create", { folderId, title, url, description, image });
}

export function bookmarkOpen(id: number): Promise<void> {
  return invoke("bookmark_open", { id });
}

export function bookmarkFindDuplicate(url: string): Promise<DuplicateHit | null> {
  return invoke("bookmark_find_duplicate", { url });
}

export function bookmarkUpdate(
  id: number,
  folderId: number | null,
  title: string,
  url: string,
  description: string | null,
  image: string | null,
): Promise<void> {
  return invoke("bookmark_update", { id, folderId, title, url, description, image });
}

export function bookmarkSetTags(id: number, tags: string[]): Promise<void> {
  return invoke("bookmark_set_tags", { id, tags });
}

export function bookmarkDelete(id: number): Promise<void> {
  return invoke("bookmark_delete", { id });
}

export function dbStatus(): Promise<DbStatus> {
  return invoke("db_status");
}

export function dbReveal(): Promise<void> {
  return invoke("db_reveal");
}

export function dbStartFresh(): Promise<void> {
  return invoke("db_start_fresh");
}

export function viewState(folderId: number | null): Promise<ViewState> {
  return invoke("view_state", { folderId });
}
