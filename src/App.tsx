import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import * as previewApi from "./lib/api";
import {
  bookmarkDelete,
  bookmarkOpen,
  dbStatus,
  folderBreadcrumbs,
  folderChildren,
  folderDelete,
  hotkeyStatus,
  previewFetch,
  searchQuery,
  settingsRead,
  tagCounts as fetchTagCounts,
  viewSetBandCollapsed,
  viewState,
} from "./lib/api";
import type {
  Bookmark,
  BrowserEntry,
  Crumb,
  DbStatus,
  DeleteMode,
  DuplicateHit,
  Folder,
  FolderMatch,
  FolderRef,
  HotkeyStatus,
  LinkReason,
  LinkStatus,
  LivenessItem,
  SearchHighlight,
  SearchSort,
  TagCount,
  Theme,
  ViewState,
} from "./lib/types";
import { NO_LINK_HINT } from "./lib/clipboard";
import type { MoveActive } from "./lib/folderTree";
import { reorderIds } from "./lib/insertion";
import { itemDomId } from "./lib/itemDomId";
import { avatarRelPath } from "./lib/media";
import { buildCanvasMenu, buildCardMenu, buildFolderMenu } from "./lib/menuItems";
import type { Rect } from "./lib/menuPosition";
import { durations, useReducedMotion } from "./lib/motion";
import { cancel, flushAll, pendingKeys, schedule } from "./lib/pendingDeletions";
import { plate } from "./lib/plate";
import { applyTheme, currentTheme, useTheme } from "./lib/theme";
import { SEARCH_PAGE } from "./lib/searchSummary";
import { sortBookmarks, sortFolders } from "./lib/sortRows";
import { BookmarkForm } from "./components/BookmarkForm";
import { BrowserIcon } from "./components/BrowserIcon";
import { ClipboardAddButton } from "./components/ClipboardAddButton";
import { CloseToTrayDialog } from "./components/CloseToTrayDialog";
import { CommandPalette } from "./components/CommandPalette";
import { ContextMenu } from "./components/ContextMenu";
import type { MenuAction, MenuGroup } from "./components/ContextMenu";
import { DbErrorScreen } from "./components/DbErrorScreen";
import { DeleteToast } from "./components/DeleteToast";
import { FolderDeleteDialog } from "./components/FolderDeleteDialog";
import { FolderForm } from "./components/FolderForm";
import { ImportDialog } from "./components/ImportDialog";
import { ImportToast } from "./components/ImportToast";
import { MissingBrowserToast } from "./components/MissingBrowserToast";
import { Modal } from "./components/Modal";
import { MoveToast } from "./components/MoveToast";
import type { MoveToastVariant } from "./components/MoveToast";
import { MoveToDialog } from "./components/MoveToDialog";
import { SearchField } from "./components/SearchField";
import { SettingsModal } from "./components/SettingsModal";
import { Showcase } from "./components/Showcase";
import { TagFilterBar } from "./components/TagFilterBar";
import { Titlebar } from "./components/Titlebar";

const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true']";

interface ContextMenuState {
  groups: MenuGroup[];
  anchor: Rect;
  ariaLabel: string;
  triggerId: string | null;
}

function rectFromPoint(x: number, y: number): Rect {
  return { left: x, top: y, right: x, bottom: y };
}

function resolveMenuTarget(el: HTMLElement | null): { kind: "card" | "folder"; id: number } | null {
  const item = el?.closest<HTMLElement>("[data-item]");
  if (!item) return null;
  const id = Number(item.id.slice(1));
  if (!Number.isFinite(id)) return null;
  if (item.id.startsWith("f")) return { kind: "folder", id };
  if (item.id.startsWith("b")) return { kind: "card", id };
  return null;
}

function OpenWithAvatar({
  avatarFile,
  profileKey,
  letter,
}: {
  avatarFile: string | null;
  profileKey: string;
  letter: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    if (!avatarFile) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    previewApi.mediaPath(avatarRelPath(avatarFile)).then((full) => {
      if (!cancelled) setSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [avatarFile]);

  const swatch = plate(profileKey, currentTheme());
  const showImg = loaded && src;

  return (
    <span className="browser-avatar" style={showImg ? undefined : { background: swatch.bg }}>
      {src && (
        <img
          className="browser-avatar-img"
          src={src}
          alt=""
          style={loaded ? undefined : { display: "none" }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
      )}
      {!showImg && (
        <span className="browser-avatar-letter" style={{ color: swatch.fg }}>
          {letter}
        </span>
      )}
    </span>
  );
}

interface DeleteToastEntry {
  key: string;
  label: string;
  hiding: boolean;
}

interface MissingToastEntry {
  key: string;
  kind: "browser" | "profile";
  name: string;
}

interface ImportToastEntry {
  key: string;
  folders: number;
  bookmarks: number;
}

interface MoveToastEntry {
  key: string;
  variant: MoveToastVariant;
  folderName?: string;
  undo: () => Promise<void>;
  hiding: boolean;
}

interface MoveDialogState {
  active: MoveActive;
  folders: FolderRef[];
  loadFailed: boolean;
  triggerId: string;
}

function reorderById<T extends { id: number }>(items: T[], ids: number[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const known = new Set(ids);
  const reordered = ids.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
  const rest = items.filter((item) => !known.has(item.id));
  return [...reordered, ...rest];
}

function App() {
  const [dbState, setDbState] = useState<DbStatus | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [creatingBookmark, setCreatingBookmark] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [highlightBookmarkId, setHighlightBookmarkId] = useState<number | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ id: number; name: string } | null>(null);
  const [deleteToasts, setDeleteToasts] = useState<DeleteToastEntry[]>([]);
  const [missingToasts, setMissingToasts] = useState<MissingToastEntry[]>([]);
  const [moveToasts, setMoveToasts] = useState<MoveToastEntry[]>([]);
  const [pendingDeleteKeys, setPendingDeleteKeys] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewState | null>(null);
  const [previewPendingIds, setPreviewPendingIds] = useState<Set<number>>(new Set());
  const [hotkeyState, setHotkeyState] = useState<HotkeyStatus | null>(null);
  const [clipboardPrefillUrl, setClipboardPrefillUrl] = useState<string | undefined>(undefined);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Bookmark[]>([]);
  const [searchFolders, setSearchFolders] = useState<Folder[]>([]);
  const [searchFolderMatches, setSearchFolderMatches] = useState<Record<number, FolderMatch>>({});
  const [searchHighlights, setSearchHighlights] = useState<Record<number, SearchHighlight>>({});
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchScopeFolderId, setSearchScopeFolderId] = useState<number | null>(null);
  const [searchSort, setSearchSort] = useState<SearchSort>("relevance");
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchTotalGlobal, setSearchTotalGlobal] = useState(0);
  const [searchInCurrentFolder, setSearchInCurrentFolder] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importToasts, setImportToasts] = useState<ImportToastEntry[]>([]);
  const [closeAskOpen, setCloseAskOpen] = useState(false);
  const [moveDialog, setMoveDialog] = useState<MoveDialogState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [menuKey, setMenuKey] = useState(0);
  const [createTargetFolderId, setCreateTargetFolderId] = useState<number | null>(null);
  const [browsers, setBrowsers] = useState<BrowserEntry[]>([]);
  const browsersRef = useRef<BrowserEntry[]>(browsers);
  browsersRef.current = browsers;
  const contextMenuRef = useRef<ContextMenuState | null>(contextMenu);
  contextMenuRef.current = contextMenu;
  const currentFolderIdRef = useRef(currentFolderId);
  currentFolderIdRef.current = currentFolderId;
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const [themePref, setThemePref] = useState<Theme>("system");
  const theme = useTheme(themePref);
  applyTheme(theme);
  const moveToastSeqRef = useRef(0);
  const dbOkRef = useRef(false);
  dbOkRef.current = dbState?.ok ?? false;
  const searchGenerationRef = useRef(0);
  const bookmarkPoolRef = useRef<Bookmark[]>([]);
  const livenessQueuePausedRef = useRef(false);
  const navigateToDuplicateRef = useRef<(hit: DuplicateHit) => void>(() => {});
  navigateToDuplicateRef.current = navigateToDuplicate;
  const isSearching = searchText.trim() !== "" || selectedTags.length > 0;
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;
  const viewRef = useRef<ViewState | null>(view);
  viewRef.current = view;
  const activeFoldersRef = useRef<Folder[]>([]);

  async function reload(folderId: number | null) {
    const contents = await folderChildren(folderId);
    setFolders(contents.folders);
    setBookmarks(contents.bookmarks);
    setCrumbs(folderId === null ? [] : await folderBreadcrumbs(folderId));
    fetchTagCounts()
      .then(setTagCounts)
      .catch((err) => {
        console.error(err);
        setTagCounts([]);
      });
  }

  useEffect(() => {
    settingsRead()
      .then((settings) => setThemePref(settings.theme))
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    dbStatus().then(setDbState);
    hotkeyStatus().then(setHotkeyState).catch((err) => console.error(err));
    previewApi
      .browserList()
      .then(setBrowsers)
      .catch((err) => {
        console.error(err);
        setBrowsers([]);
      });
  }, []);

  useEffect(() => {
    if (!dbState?.ok) return;
    reload(currentFolderId);
    viewState(currentFolderId).then(setView);
  }, [currentFolderId, dbState]);

  function runSearch(text: string, options?: { offset?: number; append?: boolean }) {
    const offset = options?.offset ?? 0;
    const append = options?.append ?? false;
    const generation = ++searchGenerationRef.current;
    searchQuery({
      text,
      tags: selectedTags,
      scopeFolderId: searchScopeFolderId,
      currentFolderId,
      sort: searchSort,
      limit: SEARCH_PAGE,
      offset,
    })
      .then((results) => {
        if (searchGenerationRef.current !== generation) return;
        setSearchResults((prev) => (append ? [...prev, ...results.bookmarks] : results.bookmarks));
        setSearchFolders(results.folders);
        const folderMatchMap: Record<number, FolderMatch> = {};
        results.folders.forEach((f, i) => {
          folderMatchMap[f.id] = results.folderMatches[i];
        });
        setSearchFolderMatches(folderMatchMap);
        const highlightMap: Record<number, SearchHighlight> = {};
        results.bookmarks.forEach((b, i) => {
          highlightMap[b.id] = results.highlights[i];
        });
        setSearchHighlights((prev) => (append ? { ...prev, ...highlightMap } : highlightMap));
        setSearchTotal(results.total);
        setSearchTotalGlobal(results.totalGlobal);
        setSearchInCurrentFolder(results.inCurrentFolder);
        setSearchFailed(false);
      })
      .catch((err) => {
        console.error(err);
        if (searchGenerationRef.current !== generation) return;
        setSearchFailed(true);
      });
  }

  useEffect(() => {
    if (!dbState?.ok) return;
    if (searchText.trim() === "" && selectedTags.length === 0) {
      searchGenerationRef.current += 1;
      setSearchResults([]);
      setSearchFolders([]);
      setSearchFolderMatches({});
      setSearchHighlights({});
      setSearchFailed(false);
      setSearchScopeFolderId(null);
      setSearchTotal(0);
      setSearchTotalGlobal(0);
      setSearchInCurrentFolder(0);
      return;
    }
    runSearch(searchText);
  }, [searchText, selectedTags, dbState, currentFolderId, searchScopeFolderId, searchSort]);

  useEffect(() => {
    setSearchScopeFolderId(null);
  }, [currentFolderId]);

  function toggleTag(name: string) {
    setSelectedTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }

  function clearTags() {
    setSelectedTags([]);
  }

  function retrySearch() {
    if (!isSearching) return;
    runSearch(searchText);
  }

  function showMoreSearch() {
    if (!isSearching) return;
    runSearch(searchText, { offset: searchResults.length, append: true });
  }

  function narrowSearchToFolder() {
    setSearchScopeFolderId(currentFolderId);
  }

  function escalateSearchToGlobal() {
    setSearchScopeFolderId(null);
  }

  useEffect(() => {
    if (highlightBookmarkId === null) return;
    const timer = setTimeout(() => setHighlightBookmarkId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightBookmarkId]);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const modalOpen = document.querySelector(".modal-backdrop") !== null;

      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        if (modalOpen) return;
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search-field-input")?.focus();
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        if (modalOpen) return;
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
        if (modalOpen) return;
        const triggerId = (document.activeElement as HTMLElement | null)?.id ?? "";
        const isFolder = triggerId.startsWith("f");
        const isBookmark = triggerId.startsWith("b");
        if (!isFolder && !isBookmark) return;
        const itemId = Number(triggerId.slice(1));
        if (!Number.isFinite(itemId)) return;
        let active: MoveActive | null = null;
        if (isFolder) {
          const folder = activeFoldersRef.current.find((f) => f.id === itemId);
          if (folder) active = { kind: "folder", id: folder.id, folderId: folder.parentId };
        } else {
          const bookmark = bookmarkPoolRef.current.find((b) => b.id === itemId);
          if (bookmark) active = { kind: "bookmark", id: bookmark.id, folderId: bookmark.folderId };
        }
        if (!active) return;
        e.preventDefault();
        openMoveDialogFor(active, triggerId);
        return;
      }

      if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
        if (modalOpen) return;
        const active = document.activeElement as HTMLElement | null;
        if (!active || !active.closest(".showcase")) return;
        e.preventDefault();
        if (contextMenuRef.current) {
          setMenuKey((k) => k + 1);
          return;
        }
        const anchor = active.getBoundingClientRect();
        const resolved = resolveMenuTarget(active);
        if (resolved) {
          openMenuForTarget(resolved, anchor);
        } else {
          openCanvasMenu(anchor, null);
        }
        return;
      }

      if (e.key === "F2") {
        if (modalOpen) return;
        const resolved = resolveMenuTarget(document.activeElement as HTMLElement | null);
        if (!resolved) return;
        e.preventDefault();
        if (resolved.kind === "card") {
          const bookmark = bookmarkPoolRef.current.find((b) => b.id === resolved.id);
          if (bookmark) setEditingBookmark(bookmark);
        } else {
          const folder = activeFoldersRef.current.find((f) => f.id === resolved.id);
          if (folder) setEditingFolder(folder);
        }
        return;
      }

      if (e.key === "Delete") {
        if (modalOpen) return;
        const resolved = resolveMenuTarget(document.activeElement as HTMLElement | null);
        if (!resolved) return;
        e.preventDefault();
        if (resolved.kind === "card") {
          const bookmark = bookmarkPoolRef.current.find((b) => b.id === resolved.id);
          if (bookmark) handleDeleteBookmark(bookmark);
        } else {
          const folder = activeFoldersRef.current.find((f) => f.id === resolved.id);
          if (folder) setDeletingFolder({ id: folder.id, name: folder.name });
        }
        return;
      }

      if (e.ctrlKey && e.key === "Enter") {
        const activeId = (document.activeElement as HTMLElement | null)?.id ?? "";
        if (!activeId.startsWith("b")) return;
        const bookmarkId = Number(activeId.slice(1));
        if (!Number.isFinite(bookmarkId)) return;
        const bookmark = bookmarkPoolRef.current.find((b) => b.id === bookmarkId);
        if (!bookmark) return;
        e.preventDefault();
        navigateToDuplicateRef.current({
          id: bookmark.id,
          title: bookmark.title,
          folderId: bookmark.folderId,
          folderName: null,
        });
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (modalOpen) return;
        if (isSearchingRef.current) return;
        if (viewRef.current?.sortKey) return;
        const activeId = (document.activeElement as HTMLElement | null)?.id ?? "";
        const isFolder = activeId.startsWith("f");
        const isBookmark = activeId.startsWith("b");
        if (!isFolder && !isBookmark) return;
        const itemId = Number(activeId.slice(1));
        if (!Number.isFinite(itemId)) return;
        e.preventDefault();

        const direction = e.key === "ArrowUp" ? -1 : 1;
        const track = isFolder ? activeFoldersRef.current : bookmarkPoolRef.current;
        const ids = track.map((item) => item.id);
        const index = ids.indexOf(itemId);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= ids.length) return;
        const insertAt = direction === -1 ? target : target + 1;
        const nextIds = reorderIds(ids, index, insertAt);

        if (isFolder) {
          setFolders((prev) => reorderById(prev, nextIds));
        } else {
          setBookmarks((prev) => reorderById(prev, nextIds));
        }
        previewApi
          .itemsReorder(currentFolderIdRef.current, isFolder ? nextIds : [], isBookmark ? nextIds : [])
          .catch(() => reload(currentFolderIdRef.current));
        requestAnimationFrame(() => {
          document.getElementById(activeId)?.focus({ preventScroll: true });
        });
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  function closeContextMenu() {
    const triggerId = contextMenuRef.current?.triggerId;
    setContextMenu(null);
    if (triggerId) {
      requestAnimationFrame(() => {
        document.getElementById(triggerId)?.focus({ preventScroll: true });
      });
    }
  }

  function openMoveDialogFor(active: MoveActive, triggerId: string) {
    previewApi
      .folderListAll()
      .then((tree) => setMoveDialog({ active, folders: tree, loadFailed: false, triggerId }))
      .catch((err) => {
        console.error(err);
        setMoveDialog({ active, folders: [], loadFailed: true, triggerId });
      });
  }

  function openCreateFolder(parentId: number | null) {
    setCreateTargetFolderId(parentId);
    setCreating(true);
  }

  function openCreateBookmark(folderId: number | null) {
    setCreateTargetFolderId(folderId);
    setCreatingBookmark(true);
  }

  function openBookmarkWith(bookmark: Bookmark, browser: string | null, profile: string | null) {
    previewApi
      .bookmarkOpenWith(bookmark.id, browser, profile)
      .then((outcome) => {
        if (outcome.missingKind && outcome.missingName) {
          const key = `missing:${bookmark.id}:${Date.now()}`;
          setMissingToasts((prev) => [
            ...prev,
            { key, kind: outcome.missingKind as "browser" | "profile", name: outcome.missingName as string },
          ]);
        }
      })
      .catch((err) => console.error(err));
  }

  function checkLivenessNow(bookmark: Bookmark) {
    previewApi.livenessCheck(bookmark.id).then(handleLivenessChecked).catch((err) => console.error(err));
  }

  function refreshPreviewNow(bookmark: Bookmark) {
    handlePreviewBackfill([bookmark.id], true);
  }

  function buildOpenWithBrowserRows(bookmark: Bookmark): MenuGroup[] {
    if (browsersRef.current.length === 0) return [];
    const rows: MenuAction[] = [];
    for (const entry of browsersRef.current) {
      rows.push({
        id: `open-with-browser-${entry.key}`,
        label: entry.name,
        icon: <BrowserIcon iconKey={entry.iconKey} name={entry.name} />,
        onSelect: () => openBookmarkWith(bookmark, entry.name, null),
      });
      for (const profile of entry.profiles) {
        rows.push({
          id: `open-with-profile-${entry.key}-${profile.key}`,
          label: profile.name,
          indent: true,
          icon: (
            <OpenWithAvatar
              avatarFile={profile.avatarFile}
              profileKey={`${entry.key}:${profile.key}`}
              letter={profile.name.charAt(0).toUpperCase()}
            />
          ),
          onSelect: () => openBookmarkWith(bookmark, entry.name, profile.key),
        });
      }
    }
    return [rows];
  }

  function buildCardMenuFor(bookmark: Bookmark): MenuGroup[] {
    return buildCardMenu({
      onOpen: () => openBookmark(bookmark),
      onEdit: () => setEditingBookmark(bookmark),
      onMove: () => openMoveDialogFor({ kind: "bookmark", id: bookmark.id, folderId: bookmark.folderId }, itemDomId("bookmark", bookmark.id)),
      bookmarkUrl: bookmark.url,
      onCheckLiveness: () => checkLivenessNow(bookmark),
      onRefreshPreview: () => refreshPreviewNow(bookmark),
      onDelete: () => handleDeleteBookmark(bookmark),
      onOpenWithDefault: () => openBookmarkWith(bookmark, null, null),
      openWithBrowserGroups: buildOpenWithBrowserRows(bookmark),
    });
  }

  function buildFolderMenuFor(folder: Folder): MenuGroup[] {
    return buildFolderMenu({
      onOpen: () => openFolder(folder),
      onEdit: () => setEditingFolder(folder),
      onMove: () => openMoveDialogFor({ kind: "folder", id: folder.id, folderId: folder.parentId }, itemDomId("folder", folder.id)),
      onNewBookmarkHere: () => openCreateBookmark(folder.id),
      onNewSubfolder: () => openCreateFolder(folder.id),
      onDelete: () => setDeletingFolder({ id: folder.id, name: folder.name }),
    });
  }

  function buildCanvasMenuFor(folderId: number | null): MenuGroup[] {
    return buildCanvasMenu({
      onPasteAdd: () => previewApi.clipboardUrl().then((result) => openQuickCreate(result.url)),
      onNewBookmark: () => openCreateBookmark(folderId),
      onNewFolder: () => openCreateFolder(folderId),
    });
  }

  function openMenuForTarget(target: { kind: "card" | "folder"; id: number }, anchor: Rect) {
    if (target.kind === "card") {
      const bookmark = bookmarkPoolRef.current.find((b) => b.id === target.id);
      if (!bookmark) return;
      setContextMenu({
        groups: buildCardMenuFor(bookmark),
        anchor,
        ariaLabel: `Меню закладки ${bookmark.title}`,
        triggerId: itemDomId("bookmark", bookmark.id),
      });
    } else {
      const folder = activeFoldersRef.current.find((f) => f.id === target.id);
      if (!folder) return;
      setContextMenu({
        groups: buildFolderMenuFor(folder),
        anchor,
        ariaLabel: `Меню папки ${folder.name}`,
        triggerId: itemDomId("folder", folder.id),
      });
    }
    setMenuKey((k) => k + 1);
  }

  function openCanvasMenu(anchor: Rect, triggerId: string | null) {
    setContextMenu({
      groups: buildCanvasMenuFor(currentFolderIdRef.current),
      anchor,
      ariaLabel: "Меню холста",
      triggerId,
    });
    setMenuKey((k) => k + 1);
  }

  useEffect(() => {
    function handleContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const inEditable = Boolean(target?.closest(EDITABLE_SELECTOR));
      const hasSelection = Boolean(window.getSelection()?.toString());
      if (inEditable || hasSelection) return;
      e.preventDefault();
      if (document.querySelector(".modal-backdrop")) return;

      const isKeyboard = e.detail === 0 && e.button !== 2;

      if (isKeyboard) {
        const active = document.activeElement as HTMLElement | null;
        if (!active || !active.closest(".showcase")) return;
        if (contextMenuRef.current) {
          setMenuKey((k) => k + 1);
          return;
        }
        const anchor = active.getBoundingClientRect();
        const resolved = resolveMenuTarget(active);
        if (resolved) {
          openMenuForTarget(resolved, anchor);
        } else {
          openCanvasMenu(anchor, null);
        }
        return;
      }

      if (!target?.closest(".showcase")) return;
      const anchor = rectFromPoint(e.clientX, e.clientY);
      const resolved = resolveMenuTarget(target);
      if (!resolved) {
        openCanvasMenu(anchor, null);
        return;
      }
      target.closest<HTMLElement>("[data-item]")?.focus({ preventScroll: true });
      openMenuForTarget(resolved, anchor);
    }
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await previewApi.previewBackfillCancel().catch((err) => console.error(err));
        await flushAll();
        await getCurrentWindow().destroy();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        livenessQueuePausedRef.current = false;
        if (dbOkRef.current) reload(currentFolderIdRef.current);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen("window:close-ask", () => setCloseAskOpen(true));
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  function handleBookmarkCreated(id: number) {
    setPreviewPendingIds((prev) => new Set(prev).add(id));
    previewFetch(id)
      .catch((err) => console.error(err))
      .finally(() => {
        setPreviewPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        reload(currentFolderIdRef.current);
      });
  }

  function handlePreviewBackfill(ids: number[], force = false) {
    setPreviewPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    previewApi.previewBackfill(ids, force)
      .then((items) => {
        if (items.length === 0) return;
        setBookmarks((prev) =>
          prev.map((b) => {
            const item = items.find((i) => i.id === b.id);
            if (!item) return b;
            return {
              ...b,
              previewFile: item.file,
              previewOrigin: item.origin,
              previewFetchedAt: Math.floor(Date.now() / 1000),
            };
          }),
        );
      })
      .catch((err) => console.error(err))
      .finally(() => {
        setPreviewPendingIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      });
  }

  function handleLivenessSweep(ids: number[]) {
    if (livenessQueuePausedRef.current) return;
    setPreviewPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    previewApi
      .livenessSweep(ids)
      .then((sweep) => {
        if (sweep.discarded) {
          livenessQueuePausedRef.current = true;
          return;
        }
        if (sweep.items.length === 0) return;
        setBookmarks((prev) =>
          prev.map((b) => {
            const item = sweep.items.find((i) => i.id === b.id);
            if (!item) return b;
            return {
              ...b,
              linkStatus: item.linkStatus as LinkStatus,
              linkReason: item.linkReason as LinkReason | null,
              httpStatus: item.httpStatus,
              lastCheckedAt: item.lastCheckedAt,
              failCount: item.failCount,
            };
          }),
        );
      })
      .catch((err) => console.error(err))
      .finally(() => {
        setPreviewPendingIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      });
  }

  function handleLivenessChecked(item: LivenessItem) {
    const merge = (b: Bookmark) => ({
      ...b,
      linkStatus: item.linkStatus as LinkStatus,
      linkReason: item.linkReason as LinkReason | null,
      httpStatus: item.httpStatus,
      lastCheckedAt: item.lastCheckedAt,
      failCount: item.failCount,
    });
    setBookmarks((prev) => prev.map((b) => (b.id === item.id ? merge(b) : b)));
    setEditingBookmark((prev) => (prev && prev.id === item.id ? merge(prev) : prev));
  }

  function closeEditingBookmark() {
    setEditingBookmark(null);
    reload(currentFolderId);
  }

  function openQuickCreate(url: string | null) {
    setClipboardPrefillUrl(url ?? undefined);
    setClipboardHint(url ? null : NO_LINK_HINT);
    openCreateBookmark(currentFolderIdRef.current);
  }

  function navigateToDuplicate(hit: DuplicateHit) {
    setHighlightBookmarkId(hit.id);
    setCurrentFolderId(hit.folderId);
  }

  function openFolder(folder: Folder) {
    setCurrentFolderId(folder.id);
  }

  function openBookmark(bookmark: Bookmark) {
    bookmarkOpen(bookmark.id)
      .then((outcome) => {
        if (outcome.missingKind && outcome.missingName) {
          const key = `missing:${bookmark.id}:${Date.now()}`;
          setMissingToasts((prev) => [
            ...prev,
            { key, kind: outcome.missingKind as "browser" | "profile", name: outcome.missingName as string },
          ]);
        }
      })
      .catch((err) => console.error(err));
  }

  function dismissMissingToast(key: string) {
    setMissingToasts((prev) => prev.filter((t) => t.key !== key));
  }

  function dismissImportToast(key: string) {
    setImportToasts((prev) => prev.filter((t) => t.key !== key));
  }

  function handleImportPathPicked(path: string) {
    setSettingsOpen(false);
    setImportPath(path);
  }

  function handleImported(applied: { folders: number; bookmarks: number }) {
    const key = `import:${Date.now()}`;
    setImportToasts((prev) => [...prev, { key, ...applied }]);
    setCurrentFolderId(null);
    reload(null);
  }

  function toggleBandCollapsed() {
    if (!view) return;
    const next = !view.bandCollapsed;
    setView({ ...view, bandCollapsed: next });
    viewSetBandCollapsed(currentFolderId, next).catch((err) => console.error(err));
  }

  function startDelete(key: string, label: string, run: () => Promise<void>) {
    schedule(key, async () => {
      setDeleteToasts((prev) => prev.map((t) => (t.key === key ? { ...t, hiding: true } : t)));
      setTimeout(() => {
        setDeleteToasts((prev) => prev.filter((t) => t.key !== key));
      }, durations(reducedMotionRef.current).exit);
      try {
        await run();
      } catch (err) {
        console.error(err);
      } finally {
        setPendingDeleteKeys(pendingKeys());
        reload(currentFolderIdRef.current);
      }
    });
    setPendingDeleteKeys(pendingKeys());
    setDeleteToasts((prev) => [...prev, { key, label, hiding: false }]);
  }

  function cancelDelete(key: string) {
    if (!cancel(key)) return;
    setPendingDeleteKeys(pendingKeys());
    setDeleteToasts((prev) => prev.filter((t) => t.key !== key));
  }

  function handleMoveToast(entry: { variant: MoveToastVariant; folderName?: string; undo: () => Promise<void> }) {
    const key = `move:${++moveToastSeqRef.current}`;
    schedule(key, () => {
      setMoveToasts((prev) => prev.map((t) => (t.key === key ? { ...t, hiding: true } : t)));
      setTimeout(() => {
        setMoveToasts((prev) => prev.filter((t) => t.key !== key));
      }, durations(reducedMotionRef.current).exit);
    });
    setMoveToasts((prev) => [...prev, { key, ...entry, hiding: false }]);
  }

  function cancelMove(key: string) {
    cancel(key);
    const entry = moveToasts.find((t) => t.key === key);
    setMoveToasts((prev) => prev.filter((t) => t.key !== key));
    if (!entry) return;
    entry
      .undo()
      .then(() => reload(currentFolderIdRef.current))
      .catch((err) => console.error(err));
  }

  function closeMoveDialog() {
    const triggerId = moveDialog?.triggerId;
    setMoveDialog(null);
    if (!triggerId) return;
    requestAnimationFrame(() => {
      document.getElementById(triggerId)?.focus({ preventScroll: true });
    });
  }

  async function commitDialogMove(active: MoveActive, targetFolderId: number | null, targetName: string) {
    if (targetFolderId === active.folderId) return;
    const folderIdNow = currentFolderIdRef.current;
    const sortActive = viewRef.current?.mode === "compact" && Boolean(viewRef.current?.sortKey);
    const prevSortKey = viewRef.current?.sortKey ?? null;
    const prevSortDir = viewRef.current?.sortDir ?? null;

    if (sortActive && prevSortKey && prevSortDir) {
      const remaining =
        active.kind === "folder"
          ? activeFoldersRef.current.filter((f) => f.id !== active.id)
          : bookmarkPoolRef.current.filter((b) => b.id !== active.id);
      const nextIds =
        active.kind === "folder"
          ? sortFolders(remaining as Folder[], prevSortKey, prevSortDir).map((f) => f.id)
          : sortBookmarks(remaining as Bookmark[], prevSortKey, prevSortDir).map((b) => b.id);
      try {
        await previewApi.itemsReorder(
          folderIdNow,
          active.kind === "folder" ? nextIds : [],
          active.kind === "folder" ? [] : nextIds,
        );
        await previewApi.viewSetSort(folderIdNow, null, null);
        setView(await viewState(folderIdNow));
      } catch (err) {
        console.error(err);
        await reload(folderIdNow);
        return;
      }
    }

    let undoMove: () => Promise<void>;
    try {
      if (active.kind === "bookmark") {
        const bookmark = bookmarkPoolRef.current.find((b) => b.id === active.id);
        if (!bookmark) throw new Error("stale bookmark");
        await previewApi.bookmarkUpdate(
          bookmark.id,
          targetFolderId,
          bookmark.title,
          bookmark.url,
          bookmark.description,
          bookmark.image,
        );
        undoMove = () =>
          previewApi.bookmarkUpdate(
            bookmark.id,
            active.folderId,
            bookmark.title,
            bookmark.url,
            bookmark.description,
            bookmark.image,
          );
      } else {
        const folder = activeFoldersRef.current.find((f) => f.id === active.id);
        if (!folder) throw new Error("stale folder");
        await previewApi.folderMove(folder.id, targetFolderId);
        undoMove = () => previewApi.folderMove(folder.id, active.folderId);
      }
    } catch (err) {
      console.error(err);
      await reload(folderIdNow);
      return;
    }

    await reload(folderIdNow);

    if (sortActive && prevSortKey && prevSortDir) {
      handleMoveToast({
        variant: "sorted",
        undo: async () => {
          await undoMove();
          await previewApi.viewSetSort(folderIdNow, prevSortKey, prevSortDir);
          setView(await viewState(folderIdNow));
        },
      });
    } else {
      handleMoveToast({ variant: "moved", folderName: targetName, undo: undoMove });
    }
  }

  function handleDialogMove(targetFolderId: number | null, targetName: string) {
    if (!moveDialog) return;
    const active = moveDialog.active;
    closeMoveDialog();
    void commitDialogMove(active, targetFolderId, targetName);
  }

  function handleDeleteBookmark(bookmark: Bookmark) {
    startDelete(`bookmark:${bookmark.id}`, bookmark.title, () => bookmarkDelete(bookmark.id));
  }

  function handleConfirmFolderDelete(mode: DeleteMode) {
    if (!deletingFolder) return;
    const folder = deletingFolder;
    const isCurrentFolder = folder.id === currentFolderId;
    const parentId = crumbs[crumbs.length - 2]?.id ?? null;
    setDeletingFolder(null);
    if (isCurrentFolder) {
      setCurrentFolderId(parentId);
    }
    startDelete(`folder:${folder.id}`, folder.name, () => folderDelete(folder.id, mode));
  }

  const currentFolderName = crumbs.length > 0 ? crumbs[crumbs.length - 1].name : null;
  const visibleFolders = folders.filter((f) => !pendingDeleteKeys.has(`folder:${f.id}`));
  const visibleBookmarks = bookmarks.filter((b) => !pendingDeleteKeys.has(`bookmark:${b.id}`));
  const activeFolders = isSearching ? searchFolders : visibleFolders;
  const activeBookmarks = isSearching ? searchResults : visibleBookmarks;
  bookmarkPoolRef.current = activeBookmarks;
  activeFoldersRef.current = activeFolders;
  const firstResultId =
    activeFolders.length > 0
      ? itemDomId("folder", activeFolders[0].id)
      : activeBookmarks.length > 0
        ? itemDomId("bookmark", activeBookmarks[0].id)
        : null;
  const firstBookmark = activeBookmarks[0] ?? null;

  if (dbState === null) {
    return (
      <div className="app">
        <Titlebar crumbs={[]} onNavigate={() => {}} onOpenSettings={() => {}} />
      </div>
    );
  }

  if (!dbState.ok) {
    return (
      <div className="app">
        <Titlebar crumbs={[]} onNavigate={() => {}} onOpenSettings={() => setSettingsOpen(true)} />
        <DbErrorScreen
          path={dbState.path ?? ""}
          message={dbState.message ?? ""}
          onRecovered={() => dbStatus().then(setDbState)}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Titlebar crumbs={crumbs} onNavigate={setCurrentFolderId} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="app-head">
        <div className="app-head-row">
          <SearchField
            value={searchText}
            onChange={setSearchText}
            firstResultId={firstResultId}
            firstBookmark={firstBookmark}
            hasSelectedTags={selectedTags.length > 0}
            onClearTags={clearTags}
            onOpenBookmark={openBookmark}
            onNavigateToFolder={navigateToDuplicate}
          />

          <div className="toolbar">
            <button type="button" className="new-folder-button" onClick={() => openCreateFolder(currentFolderId)}>
              Новая папка
            </button>
            <button type="button" className="new-folder-button" onClick={() => openCreateBookmark(currentFolderId)}>
              Новая закладка
            </button>
            <ClipboardAddButton className="new-folder-button" onAdd={openQuickCreate} />
          </div>
        </div>

        <TagFilterBar
          tagCounts={tagCounts}
          selectedTags={selectedTags}
          onToggleTag={toggleTag}
          onClearTags={clearTags}
        />

        {hotkeyState && !hotkeyState.registered ? (
          <p className="hotkey-conflict">Комбинация {hotkeyState.combo} занята</p>
        ) : null}
      </div>

      <Showcase
        folders={activeFolders}
        bookmarks={activeBookmarks}
        ancestorIds={crumbs.map((c) => c.id)}
        searchActive={isSearching}
        searchFailed={isSearching && searchFailed}
        onRetrySearch={retrySearch}
        searchQueryText={searchText}
        searchTags={selectedTags}
        searchHighlights={searchHighlights}
        searchFolderMatches={searchFolderMatches}
        searchSort={searchSort}
        onSearchSortChange={setSearchSort}
        searchScopeFolderId={searchScopeFolderId}
        searchTotal={searchTotal}
        searchTotalGlobal={searchTotalGlobal}
        searchInCurrentFolder={searchInCurrentFolder}
        currentFolderName={currentFolderName}
        onNarrowSearchToFolder={narrowSearchToFolder}
        onEscalateSearchToGlobal={escalateSearchToGlobal}
        onShowMoreSearch={showMoreSearch}
        mode={view?.mode ?? "tiles"}
        overridesExist={view?.overridesExist ?? false}
        onViewChanged={setView}
        sortKey={view?.sortKey ?? null}
        sortDir={view?.sortDir ?? "asc"}
        folderId={currentFolderId}
        bandCollapsed={view?.bandCollapsed ?? false}
        onToggleBandCollapsed={toggleBandCollapsed}
        onOpenFolder={openFolder}
        onOpenBookmark={openBookmark}
        onAddBookmark={() => openCreateBookmark(currentFolderId)}
        onCreateFolder={() => openCreateFolder(currentFolderId)}
        previewPendingIds={previewPendingIds}
        onPasteAdd={openQuickCreate}
        onPreviewBackfill={handlePreviewBackfill}
        onLivenessSweep={handleLivenessSweep}
        onDeleteCurrentFolder={() => {
          if (currentFolderId === null) return;
          setDeletingFolder({ id: currentFolderId, name: currentFolderName ?? "" });
        }}
        highlightBookmarkId={highlightBookmarkId}
        onMoveToast={handleMoveToast}
        onReload={() => reload(currentFolderIdRef.current)}
      />

      <div className="delete-toast-stack">
        {deleteToasts.map((toast) => (
          <DeleteToast
            key={toast.key}
            label={toast.label}
            hiding={toast.hiding}
            onCancel={() => cancelDelete(toast.key)}
          />
        ))}
        {moveToasts.map((toast) => (
          <MoveToast
            key={toast.key}
            variant={toast.variant}
            folderName={toast.folderName}
            hiding={toast.hiding}
            onCancel={() => cancelMove(toast.key)}
          />
        ))}
        {missingToasts.map((toast) => (
          <MissingBrowserToast
            key={toast.key}
            kind={toast.kind}
            name={toast.name}
            onDone={() => dismissMissingToast(toast.key)}
          />
        ))}
        {importToasts.map((toast) => (
          <ImportToast
            key={toast.key}
            folders={toast.folders}
            bookmarks={toast.bookmarks}
            onDone={() => dismissImportToast(toast.key)}
          />
        ))}
      </div>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <FolderForm
            folder={null}
            parentId={createTargetFolderId}
            onClose={() => setCreating(false)}
            onSaved={() => reload(currentFolderId)}
          />
        </Modal>
      )}

      {editingFolder && (
        <Modal onClose={() => setEditingFolder(null)}>
          <FolderForm
            folder={editingFolder}
            parentId={currentFolderId}
            onClose={() => setEditingFolder(null)}
            onSaved={() => reload(currentFolderId)}
          />
        </Modal>
      )}

      {deletingFolder && (
        <Modal onClose={() => setDeletingFolder(null)}>
          <FolderDeleteDialog
            folder={deletingFolder}
            parentName={currentFolderName}
            onClose={() => setDeletingFolder(null)}
            onConfirm={handleConfirmFolderDelete}
          />
        </Modal>
      )}

      {creatingBookmark && (
        <Modal
          onClose={() => {
            setCreatingBookmark(false);
            setClipboardPrefillUrl(undefined);
            setClipboardHint(null);
          }}
        >
          <BookmarkForm
            bookmark={null}
            folderId={createTargetFolderId}
            initialUrl={clipboardPrefillUrl}
            urlHint={clipboardHint}
            autoFocusField={clipboardHint ? "url" : undefined}
            onClose={() => {
              setCreatingBookmark(false);
              setClipboardPrefillUrl(undefined);
              setClipboardHint(null);
            }}
            onSaved={(createdId) => {
              reload(currentFolderId);
              if (createdId !== undefined) handleBookmarkCreated(createdId);
            }}
            onNavigateToDuplicate={navigateToDuplicate}
          />
        </Modal>
      )}

      {editingBookmark && (
        <Modal onClose={closeEditingBookmark}>
          <BookmarkForm
            bookmark={editingBookmark}
            folderId={currentFolderId}
            onClose={closeEditingBookmark}
            onSaved={() => {}}
            onNavigateToDuplicate={navigateToDuplicate}
            onLivenessChecked={handleLivenessChecked}
          />
        </Modal>
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onThemeChange={setThemePref}
          onHotkeyChange={setHotkeyState}
          onImportPathPicked={handleImportPathPicked}
        />
      )}

      {importPath && (
        <Modal onClose={() => setImportPath(null)}>
          <ImportDialog path={importPath} onClose={() => setImportPath(null)} onImported={handleImported} />
        </Modal>
      )}

      {closeAskOpen && (
        <Modal onClose={() => setCloseAskOpen(false)}>
          <CloseToTrayDialog
            onTray={() => {
              setCloseAskOpen(false);
              invoke("close_to_tray").catch((err) => console.error(err));
            }}
            onQuit={() => {
              setCloseAskOpen(false);
              invoke("app_quit").catch((err) => console.error(err));
            }}
          />
        </Modal>
      )}

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenFolder={openFolder}
          onOpenBookmark={openBookmark}
          onNavigateToFolder={navigateToDuplicate}
        />
      )}

      {moveDialog && (
        <MoveToDialog
          active={moveDialog.active}
          folders={moveDialog.folders}
          loadFailed={moveDialog.loadFailed}
          onClose={closeMoveDialog}
          onMove={handleDialogMove}
        />
      )}

      {contextMenu && (
        <ContextMenu
          key={menuKey}
          groups={contextMenu.groups}
          anchor={contextMenu.anchor}
          ariaLabel={contextMenu.ariaLabel}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

export default App;
