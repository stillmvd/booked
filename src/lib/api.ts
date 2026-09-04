import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir, join } from "@tauri-apps/api/path";

import { isoStampForFilename } from "./dates";
import type { SortDir, SortKey } from "./sortRows";
import type {
  AppSettings,
  BrowserEntry,
  BrowserTarget,
  ClipboardUrl,
  ContentsCount,
  Crumb,
  DbStatus,
  DeleteMode,
  DuplicateHit,
  FolderContents,
  FolderRef,
  FolderTree,
  HotkeyStatus,
  ImportApplied,
  ImportInspection,
  ImportMode,
  LivenessItem,
  LivenessSweep,
  MetaInfo,
  OpenOutcome,
  PreviewBackfillItem,
  PreviewInfo,
  SearchRequest,
  SearchResults,
  TagCount,
  ViewMode,
  ViewState,
} from "./types";
import type { UpdateInfo } from "./types";

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

export function folderTree(): Promise<FolderTree> {
  return invoke("folder_tree");
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

export function tagCounts(): Promise<TagCount[]> {
  return invoke("tag_counts");
}

export function imageImport(source: string): Promise<string> {
  return invoke("image_import", { source });
}

export function imageImportBytes(bytes: Uint8Array): Promise<string> {
  return invoke("image_import_bytes", bytes);
}

let localDataDirCache: Promise<string> | null = null;

function localDataDir(): Promise<string> {
  if (!localDataDirCache) localDataDirCache = appLocalDataDir();
  return localDataDirCache;
}

export async function imagePath(filename: string): Promise<string> {
  const dir = await localDataDir();
  return join(dir, "images", filename);
}

export async function mediaPath(segments: string[]): Promise<string> {
  const dir = await localDataDir();
  return join(dir, ...segments);
}

export function previewFetch(id: number): Promise<PreviewInfo> {
  return invoke("preview_fetch", { id });
}

export function previewRefresh(id: number): Promise<PreviewInfo> {
  return invoke("preview_refresh", { id });
}

export function previewClearUserImage(id: number): Promise<void> {
  return invoke("preview_clear_user_image", { id });
}

export function previewBackfill(ids: number[], force = false): Promise<PreviewBackfillItem[]> {
  return invoke("preview_backfill", { ids, force });
}

export function previewBackfillCancel(): Promise<void> {
  return invoke("preview_backfill_cancel");
}

export function livenessSweep(ids: number[], force = false): Promise<LivenessSweep> {
  return invoke("liveness_sweep", { ids, force });
}

export function livenessCheck(id: number): Promise<LivenessItem> {
  return invoke("liveness_check", { id });
}

export function metaFetch(url: string): Promise<MetaInfo> {
  return invoke("meta_fetch", { url });
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

export function bookmarkOpen(id: number): Promise<OpenOutcome> {
  return invoke("bookmark_open", { id });
}

export function browserList(): Promise<BrowserEntry[]> {
  return invoke("browser_list");
}

export function browserDefaultGet(): Promise<BrowserTarget> {
  return invoke("browser_default_get");
}

export function browserDefaultSet(target: BrowserTarget): Promise<void> {
  return invoke("browser_default_set", { target });
}

export function bookmarkSetBrowser(
  id: number,
  browser: string | null,
  profile: string | null,
  profileName: string | null,
): Promise<void> {
  return invoke("bookmark_set_browser", { id, browser, profile, profileName });
}

export function bookmarkOpenWith(id: number, browser: string | null, profile: string | null): Promise<OpenOutcome> {
  return invoke("bookmark_open_with", { id, browser, profile });
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

export function updateCheck(): Promise<UpdateInfo | null> {
  return invoke("update_check");
}

export function updateDownload(): Promise<number> {
  return invoke("update_download");
}

export function updateInstall(): Promise<void> {
  return invoke("update_install");
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

export function viewSetBandCollapsed(folderId: number | null, collapsed: boolean): Promise<void> {
  return invoke("view_set_band_collapsed", { folderId, collapsed });
}

export function viewSetMode(folderId: number | null, mode: ViewMode): Promise<void> {
  return invoke("view_set_mode", { folderId, mode });
}

export function viewResetOverrides(mode: ViewMode): Promise<void> {
  return invoke("view_reset_overrides", { mode });
}

export function viewSetSort(folderId: number | null, key: SortKey | null, dir: SortDir | null): Promise<void> {
  return invoke("view_set_sort", { folderId, key, dir });
}

export function clipboardUrl(): Promise<ClipboardUrl> {
  return invoke("clipboard_url");
}

export function hotkeyStatus(): Promise<HotkeyStatus> {
  return invoke("hotkey_status");
}

export function hotkeySet(combo: string): Promise<HotkeyStatus> {
  return invoke("hotkey_set", { combo });
}

export function quickAddSetDirty(dirty: boolean): Promise<void> {
  return invoke("quick_add_set_dirty", { dirty });
}

export function searchQuery(request: SearchRequest): Promise<SearchResults> {
  return invoke("search_query", { request });
}

export function itemsReorder(folderId: number | null, folderIds: number[], bookmarkIds: number[]): Promise<void> {
  return invoke("items_reorder", { folderId, folderIds, bookmarkIds });
}

export function settingsRead(): Promise<AppSettings> {
  return invoke("settings_read");
}

export function settingsWrite(key: string, value: string): Promise<void> {
  return invoke("settings_write", { key, value });
}

export function autostartSupported(): Promise<boolean> {
  return invoke("autostart_supported");
}

export function autostartGet(): Promise<boolean> {
  return invoke("autostart_get");
}

export function autostartSet(enabled: boolean): Promise<void> {
  return invoke("autostart_set", { enabled });
}

export function backupExport(path: string): Promise<void> {
  return invoke("backup_export", { path });
}

export async function backupAutoExport(): Promise<string> {
  const dir = await localDataDir();
  const path = await join(dir, "backups", `booked-${isoStampForFilename(new Date())}.json`);
  await backupExport(path);
  return path;
}

export function backupInspect(path: string): Promise<ImportInspection> {
  return invoke("backup_inspect", { path });
}

export function backupImport(path: string, mode: ImportMode): Promise<ImportApplied> {
  return invoke("backup_import", { path, mode });
}
