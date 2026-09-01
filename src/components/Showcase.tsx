import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { Announcements, DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";

import * as api from "../lib/api";
import { BAND_MORE_DROP_ID, folderIdFromDragId, isFolderDragId } from "../lib/dragIds";
import { isDropAllowed } from "../lib/dropRules";
import type { DragItem } from "../lib/dropRules";
import { computeShifts, staggerDelay } from "../lib/flip";
import type { RectLike } from "../lib/flip";
import { insertionIndexGrid, insertionIndexVertical, reorderIds } from "../lib/insertion";
import type { Rect } from "../lib/insertion";
import { itemDomId } from "../lib/itemDomId";
import { durations, useReducedMotion } from "../lib/motion";
import { createPreviewQueue } from "../lib/previewQueue";
import { hasMore } from "../lib/searchSummary";
import { sortBookmarks, sortFolders } from "../lib/sortRows";
import type { SortDir, SortKey } from "../lib/sortRows";
import type { Bookmark, Folder, FolderMatch, SearchHighlight, SearchSort, ViewMode, ViewState } from "../lib/types";
import { useShowcaseNav } from "../lib/useShowcaseNav";
import { BookmarkCard } from "./BookmarkCard";
import { CompactHead } from "./CompactHead";
import { CompactRow } from "./CompactRow";
import { EmptyFolder } from "./EmptyFolder";
import { FolderRow } from "./FolderRow";
import { FolderTile } from "./FolderTile";
import { FoldersBand } from "./FoldersBand";
import { ListRow } from "./ListRow";
import type { MoveToastVariant } from "./MoveToast";
import { ModeSwitch } from "./ModeSwitch";
import { ResultsSummary, ShowMoreButton } from "./ResultsSummary";

const PREVIEW_OBSERVER_ROOT_MARGIN = "200px";
const GRID_GAP = 16;
const SPRING_LOAD_MS = 300;

export interface ShowcaseProps {
  folders: Folder[];
  bookmarks: Bookmark[];
  ancestorIds: number[];
  searchActive?: boolean;
  searchFailed?: boolean;
  onRetrySearch?: () => void;
  searchQueryText?: string;
  searchTags?: string[];
  searchHighlights?: Record<number, SearchHighlight>;
  searchFolderMatches?: Record<number, FolderMatch>;
  searchSort?: SearchSort;
  onSearchSortChange?: (sort: SearchSort) => void;
  searchScopeFolderId?: number | null;
  searchTotal?: number;
  searchTotalGlobal?: number;
  searchInCurrentFolder?: number;
  currentFolderName?: string | null;
  onNarrowSearchToFolder?: () => void;
  onEscalateSearchToGlobal?: () => void;
  onShowMoreSearch?: () => void;
  mode: ViewMode;
  overridesExist: boolean;
  onViewChanged: (view: ViewState) => void;
  sortKey: SortKey | null;
  sortDir: SortDir;
  folderId: number | null;
  bandCollapsed: boolean;
  onToggleBandCollapsed: () => void;
  onOpenFolder: (folder: Folder) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onAddBookmark: () => void;
  onCreateFolder: () => void;
  onDeleteCurrentFolder: () => void;
  highlightBookmarkId: number | null;
  previewPendingIds: Set<number>;
  onPasteAdd: (url: string | null) => void;
  onPreviewBackfill: (ids: number[], force?: boolean) => void;
  onLivenessSweep: (ids: number[]) => void;
  onMoveToast: (entry: { variant: MoveToastVariant; folderName?: string; undo: () => Promise<void> }) => void;
  onReload: () => Promise<void>;
}

const PASTE_NATIVE_TARGETS = "INPUT, TEXTAREA, [contenteditable]";

function isNativePasteTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest(PASTE_NATIVE_TARGETS));
}

interface VerticalLine {
  left: number;
  top: number;
  height: number;
}

interface FoldersSectionProps {
  folders: Folder[];
  folderId: number | null;
  bandCollapsed: boolean;
  firstItemId: string | null;
  folderMatches?: Record<number, FolderMatch>;
  dragDisabled?: boolean;
  insertionLineVertical?: VerticalLine | null;
  dropTargetFolderId?: number | null;
  noDropFolderId?: number | null;
  onToggleBandCollapsed: () => void;
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
}

function FoldersSection({
  folders,
  folderId,
  bandCollapsed,
  firstItemId,
  folderMatches,
  dragDisabled,
  insertionLineVertical,
  dropTargetFolderId,
  noDropFolderId,
  onToggleBandCollapsed,
  onOpenFolder,
  onEditFolder,
  onDeleteFolder,
}: FoldersSectionProps) {
  if (folders.length === 0) return null;
  return (
    <FoldersBand
      key={folderId ?? "root"}
      folders={folders}
      collapsed={bandCollapsed}
      firstItemId={firstItemId}
      folderMatches={folderMatches}
      dragDisabled={dragDisabled}
      insertionLineVertical={insertionLineVertical}
      dropTargetFolderId={dropTargetFolderId}
      noDropFolderId={noDropFolderId}
      onToggleCollapsed={onToggleBandCollapsed}
      onOpenFolder={onOpenFolder}
      onEditFolder={onEditFolder}
      onDeleteFolder={onDeleteFolder}
    />
  );
}

interface BookmarksSectionProps {
  bookmarks: Bookmark[];
  highlightBookmarkId: number | null;
  firstItemId: string | null;
  previewPendingIds: Set<number>;
  searchMode?: boolean;
  highlights?: Record<number, SearchHighlight>;
  searchTags?: string[];
  dragDisabled?: boolean;
  insertionLineVertical?: VerticalLine | null;
  staggerStep?: number;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onAddBookmark: () => void;
  onCacheMiss: (id: number) => void;
}

function BookmarksSection({
  bookmarks,
  highlightBookmarkId,
  firstItemId,
  previewPendingIds,
  searchMode = false,
  highlights,
  searchTags,
  dragDisabled,
  insertionLineVertical,
  staggerStep,
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
  onAddBookmark,
  onCacheMiss,
}: BookmarksSectionProps) {
  if (bookmarks.length === 0) {
    if (searchMode) return null;
    return (
      <p className="showcase-note">
        Здесь пока нет закладок ·{" "}
        <button type="button" onClick={onAddBookmark}>
          Добавить
        </button>
      </p>
    );
  }
  return (
    <div>
      <button type="button" className="band-head">
        <span>Закладки · {bookmarks.length}</span>
      </button>
      <div className="card-grid">
        {bookmarks.map((bookmark, index) => (
          <div
            key={bookmark.id}
            className={staggerStep !== undefined ? "card-enter" : undefined}
            style={
              staggerStep !== undefined
                ? ({ "--card-enter-delay": `${staggerDelay(index, 8, staggerStep)}ms` } as React.CSSProperties)
                : undefined
            }
          >
            <BookmarkCard
              bookmark={bookmark}
              highlighted={highlightBookmarkId === bookmark.id}
              tabIndex={itemDomId("bookmark", bookmark.id) === firstItemId ? 0 : -1}
              previewPending={previewPendingIds.has(bookmark.id)}
              highlight={highlights?.[bookmark.id]}
              searchTags={searchTags}
              dragDisabled={dragDisabled}
              onOpen={() => onOpenBookmark(bookmark)}
              onEdit={() => onEditBookmark(bookmark)}
              onDelete={() => onDeleteBookmark(bookmark)}
              onCacheMiss={onCacheMiss}
            />
          </div>
        ))}
        {insertionLineVertical && (
          <div
            className="insertion-line vertical"
            style={{
              left: insertionLineVertical.left,
              top: insertionLineVertical.top,
              height: insertionLineVertical.height,
            }}
          />
        )}
      </div>
    </div>
  );
}

interface RowsSectionProps {
  folders: Folder[];
  bookmarks: Bookmark[];
  mode: ViewMode;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  highlightBookmarkId: number | null;
  firstItemId: string | null;
  previewPendingIds: Set<number>;
  highlights?: Record<number, SearchHighlight>;
  folderMatches?: Record<number, FolderMatch>;
  searchTags?: string[];
  dragDisabled?: boolean;
  insertionLineTop?: number | null;
  dropTargetFolderId?: number | null;
  noDropFolderId?: number | null;
  staggerStep?: number;
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onCacheMiss: (id: number) => void;
}

function rowEnterProps(index: number, staggerStep: number | undefined): { className?: string; style?: React.CSSProperties } {
  if (staggerStep === undefined) return {};
  return {
    className: "card-enter",
    style: { "--card-enter-delay": `${staggerDelay(index, 8, staggerStep)}ms` } as React.CSSProperties,
  };
}

function RowsSection({
  folders,
  bookmarks,
  mode,
  sortKey,
  sortDir,
  onSort,
  highlightBookmarkId,
  firstItemId,
  previewPendingIds,
  highlights,
  folderMatches,
  searchTags,
  dragDisabled,
  insertionLineTop,
  dropTargetFolderId,
  noDropFolderId,
  staggerStep,
  onOpenFolder,
  onEditFolder,
  onDeleteFolder,
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
  onCacheMiss,
}: RowsSectionProps) {
  const compact = mode === "compact";
  const rowsDragDisabled = dragDisabled;

  const sortedFolders = compact && sortKey ? sortFolders(folders, sortKey, sortDir) : folders;
  const sortedBookmarks = compact && sortKey ? sortBookmarks(bookmarks, sortKey, sortDir) : bookmarks;

  return (
    <div className="rows">
      {compact && <CompactHead sortKey={sortKey} sortDir={sortDir} onSort={onSort} />}
      {sortedFolders.map((folder, index) => (
        <div key={folder.id} {...rowEnterProps(index, staggerStep)}>
          <FolderRow
            folder={folder}
            compact={compact}
            tabIndex={itemDomId("folder", folder.id) === firstItemId ? 0 : -1}
            match={folderMatches?.[folder.id]}
            dragDisabled={rowsDragDisabled}
            dropTarget={dropTargetFolderId === folder.id}
            noDrop={noDropFolderId === folder.id}
            onOpen={() => onOpenFolder(folder)}
            onEdit={() => onEditFolder(folder)}
            onDelete={() => onDeleteFolder(folder)}
          />
        </div>
      ))}
      {sortedBookmarks.map((bookmark, index) => (
        <div key={bookmark.id} {...rowEnterProps(sortedFolders.length + index, staggerStep)}>
          {compact ? (
            <CompactRow
              bookmark={bookmark}
              highlighted={highlightBookmarkId === bookmark.id}
              tabIndex={itemDomId("bookmark", bookmark.id) === firstItemId ? 0 : -1}
              previewPending={previewPendingIds.has(bookmark.id)}
              highlight={highlights?.[bookmark.id]}
              searchTags={searchTags}
              dragDisabled={rowsDragDisabled}
              onOpen={() => onOpenBookmark(bookmark)}
              onEdit={() => onEditBookmark(bookmark)}
              onDelete={() => onDeleteBookmark(bookmark)}
              onCacheMiss={onCacheMiss}
            />
          ) : (
            <ListRow
              bookmark={bookmark}
              highlighted={highlightBookmarkId === bookmark.id}
              tabIndex={itemDomId("bookmark", bookmark.id) === firstItemId ? 0 : -1}
              previewPending={previewPendingIds.has(bookmark.id)}
              highlight={highlights?.[bookmark.id]}
              searchTags={searchTags}
              dragDisabled={rowsDragDisabled}
              onOpen={() => onOpenBookmark(bookmark)}
              onEdit={() => onEditBookmark(bookmark)}
              onDelete={() => onDeleteBookmark(bookmark)}
              onCacheMiss={onCacheMiss}
            />
          )}
        </div>
      ))}
      {insertionLineTop !== null && insertionLineTop !== undefined && (
        <div className="insertion-line horizontal" style={{ top: insertionLineTop }} />
      )}
    </div>
  );
}

function collectTrackRects(selector: string, prefix: "b" | "f"): { rects: Rect[]; ids: number[] } {
  const rects: Rect[] = [];
  const ids: number[] = [];
  const container = document.querySelector<HTMLElement>(selector);
  if (!container) return { rects, ids };
  for (const el of container.querySelectorAll<HTMLElement>("[data-item]")) {
    if (!el.id.startsWith(prefix)) continue;
    const id = Number(el.id.slice(1));
    if (!Number.isFinite(id)) continue;
    const r = el.getBoundingClientRect();
    rects.push({ top: r.top, height: r.height, left: r.left, width: r.width });
    ids.push(id);
  }
  return { rects, ids };
}

interface ItemSnapshot {
  top: number;
  left: number;
  clone: HTMLElement;
  boxWidth: number;
  boxHeight: number;
}

function captureItemSnapshot(container: HTMLElement | null): Map<string, ItemSnapshot> {
  const snapshot = new Map<string, ItemSnapshot>();
  if (!container) return snapshot;
  for (const el of container.querySelectorAll<HTMLElement>("[data-item]")) {
    const box = el.getBoundingClientRect();
    const grid = el.closest<HTMLElement>(".folder-grid, .card-grid, .rows");
    if (!grid) continue;
    snapshot.set(el.id, {
      top: box.top,
      left: box.left,
      clone: el.cloneNode(true) as HTMLElement,
      boxWidth: box.width,
      boxHeight: box.height,
    });
  }
  return snapshot;
}

function resolveGhostContainer(id: string): HTMLElement | null {
  const primary = id.startsWith("f") ? ".folder-grid" : ".card-grid";
  return document.querySelector<HTMLElement>(primary) ?? document.querySelector<HTMLElement>(".rows");
}

function spawnLeavingGhost(id: string, entry: ItemSnapshot, exitMs: number, timers: Set<number>) {
  const container = resolveGhostContainer(id);
  if (!container) return;
  const containerBox = container.getBoundingClientRect();
  const clone = entry.clone;
  clone.removeAttribute("id");
  clone.removeAttribute("data-item");
  clone.removeAttribute("tabindex");
  clone.classList.add("leaving-ghost");
  clone.style.top = `${entry.top - containerBox.top}px`;
  clone.style.left = `${entry.left - containerBox.left}px`;
  clone.style.setProperty("--ghost-w", `${entry.boxWidth}px`);
  clone.style.setProperty("--ghost-h", `${entry.boxHeight}px`);
  container.appendChild(clone);
  requestAnimationFrame(() => {
    clone.classList.add("hiding");
  });
  const timer = window.setTimeout(() => {
    clone.remove();
    timers.delete(timer);
  }, exitMs);
  timers.add(timer);
}

type FadeVariant = { kind: "nav"; direction: "enter" | "back" | "side" } | { kind: "mode" };

function FadeSwap({ variant, children }: { variant: FadeVariant | null; children: ReactNode }) {
  const [open, setOpen] = useState(variant === null);

  useEffect(() => {
    if (variant === null) return;
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (variant === null) return <>{children}</>;

  const modifier = variant.kind === "mode" ? "showcase-fade-mode" : variant.direction === "side" ? "" : "showcase-fade-" + variant.direction;
  const className = ["showcase-fade", modifier, open ? "open" : ""].filter(Boolean).join(" ");
  return <div className={className}>{children}</div>;
}

export function Showcase(props: ShowcaseProps) {
  const {
    folders,
    bookmarks,
    ancestorIds,
    searchActive = false,
    searchFailed = false,
    onRetrySearch,
    searchQueryText = "",
    searchTags = [],
    searchHighlights,
    searchFolderMatches,
    searchSort = "relevance",
    onSearchSortChange,
    searchScopeFolderId = null,
    searchTotal = 0,
    searchTotalGlobal = 0,
    searchInCurrentFolder = 0,
    currentFolderName = null,
    onNarrowSearchToFolder,
    onEscalateSearchToGlobal,
    onShowMoreSearch,
    mode,
    overridesExist,
    onViewChanged,
    sortKey,
    sortDir,
    folderId,
    bandCollapsed,
    onToggleBandCollapsed,
    onOpenFolder,
    onOpenBookmark,
    onEditFolder,
    onDeleteFolder,
    onEditBookmark,
    onDeleteBookmark,
    onAddBookmark,
    onCreateFolder,
    onDeleteCurrentFolder,
    highlightBookmarkId,
    previewPendingIds,
    onPasteAdd,
    onPreviewBackfill,
    onLivenessSweep,
    onMoveToast,
    onReload,
  } = props;

  function focusSearchField() {
    document.querySelector<HTMLInputElement>(".search-field-input")?.focus();
  }

  const { scrollerRef, captureBeforeSwitch, onKeyDown, onFocusWithin } = useShowcaseNav(mode, focusSearchField);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const reducedMotion = useReducedMotion();

  const [localFolderOrder, setLocalFolderOrder] = useState<number[] | null>(null);
  const [localBookmarkOrder, setLocalBookmarkOrder] = useState<number[] | null>(null);
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dragOverlaySnapshot, setDragOverlaySnapshot] = useState<
    { kind: "bookmark"; bookmark: Bookmark; mode: ViewMode } | { kind: "folder"; folder: Folder; mode: ViewMode } | null
  >(null);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const [insertionLineTop, setInsertionLineTop] = useState<number | null>(null);
  const [insertionLineVertical, setInsertionLineVertical] = useState<VerticalLine | null>(null);
  const [dragPreviewWidth, setDragPreviewWidth] = useState<number | null>(null);
  const [hoverFolder, setHoverFolder] = useState<{ id: number; allowed: boolean } | null>(null);
  const initialPointerRef = useRef({ x: 0, y: 0 });
  const dragTrackIdsRef = useRef<number[]>([]);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const onOpenFolderRef = useRef(onOpenFolder);
  onOpenFolderRef.current = onOpenFolder;

  useEffect(() => {
    setLocalFolderOrder(null);
    setLocalBookmarkOrder(null);
  }, [folderId]);

  useEffect(() => {
    if (!hoverFolder?.allowed) return;
    const targetId = hoverFolder.id;
    const timer = window.setTimeout(() => {
      const folder = foldersRef.current.find((f) => f.id === targetId);
      if (!folder) return;
      setHoverFolder(null);
      onOpenFolderRef.current(folder);
    }, SPRING_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [hoverFolder]);

  const orderedFolders =
    localFolderOrder != null
      ? (localFolderOrder.map((id) => folders.find((f) => f.id === id)).filter(Boolean) as Folder[])
      : folders;

  const orderedBookmarks =
    !searchActive && localBookmarkOrder
      ? (localBookmarkOrder.map((id) => bookmarks.find((b) => b.id === id)).filter(Boolean) as Bookmark[])
      : bookmarks;

  const [navTrack, setNavTrack] = useState({ folderId, ancestorLen: ancestorIds.length });
  const [navFade, setNavFade] = useState<{ folderId: number | null; direction: "enter" | "back" | "side" } | null>(
    null,
  );
  if (navTrack.folderId !== folderId) {
    const direction: "enter" | "back" | "side" =
      ancestorIds.length > navTrack.ancestorLen ? "enter" : ancestorIds.length < navTrack.ancestorLen ? "back" : "side";
    setNavTrack({ folderId, ancestorLen: ancestorIds.length });
    setNavFade({ folderId, direction });
  }

  const [modeTrack, setModeTrack] = useState(mode);
  const [modeFade, setModeFade] = useState<{ mode: ViewMode } | null>(null);
  if (modeTrack !== mode) {
    setModeTrack(mode);
    setModeFade({ mode });
  }

  const staggerStepValue = reducedMotion ? 0 : 20;

  const flipSnapshotRef = useRef<Map<string, ItemSnapshot>>(new Map());
  const flipSignalTrackRef = useRef<string | null>(null);
  const folderTrackRef = useRef(folderId);
  const ghostTimersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    return () => {
      for (const timer of ghostTimersRef.current) window.clearTimeout(timer);
      ghostTimersRef.current.clear();
    };
  }, []);

  const searchTextActive = searchQueryText.trim() !== "";
  const flipTagsKey = [...searchTags].sort().join(",");
  const flipIdsKey = searchTextActive
    ? "text"
    : orderedFolders.map((f) => "f" + f.id).join(",") + "|" + orderedBookmarks.map((b) => "b" + b.id).join(",");
  const flipSignal = [sortKey ?? "", sortDir, flipTagsKey, flipIdsKey].join("§");

  useLayoutEffect(() => {
    const container = scrollerRef.current;
    const after = captureItemSnapshot(container);
    const before = flipSnapshotRef.current;

    const signalChanged = flipSignalTrackRef.current !== flipSignal;
    const folderChanged = folderTrackRef.current !== folderId;
    flipSignalTrackRef.current = flipSignal;
    folderTrackRef.current = folderId;

    const transientEmpty = !folderChanged && after.size === 0 && before.size > 0;
    if (transientEmpty) {
      return;
    }

    if (signalChanged && !folderChanged && before.size > 0) {
      const beforeRects = new Map<string, RectLike>();
      for (const [id, entry] of before) beforeRects.set(id, { top: entry.top, left: entry.left });
      const afterRects = new Map<string, RectLike>();
      for (const [id, entry] of after) afterRects.set(id, { top: entry.top, left: entry.left });

      const shifts = computeShifts(beforeRects, afterRects);
      const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--motion-scale")) || 0;
      const duration = durations(reducedMotion).flip;
      const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-flip").trim() || "linear";
      for (const shift of shifts) {
        const el = document.getElementById(shift.id);
        if (!el) continue;
        el.animate(
          [{ transform: `translate(${shift.dx * scale}px, ${shift.dy * scale}px)` }, { transform: "translate(0px, 0px)" }],
          { duration, easing, fill: "none" },
        );
      }

      const exitMs = durations(reducedMotion).exit;
      for (const [id, entry] of before) {
        if (after.has(id)) continue;
        spawnLeavingGhost(id, entry, exitMs, ghostTimersRef.current);
      }
    }

    flipSnapshotRef.current = after;
  });

  function resetDragState() {
    setActiveItem(null);
    setDragOverlaySnapshot(null);
    setInsertionIndex(null);
    setInsertionLineTop(null);
    setInsertionLineVertical(null);
    setDragPreviewWidth(null);
    setHoverFolder(null);
    dragTrackIdsRef.current = [];
  }

  function dragItemFor(rawId: string | number): DragItem | null {
    if (isFolderDragId(rawId)) {
      const id = folderIdFromDragId(rawId);
      const folder = folders.find((f) => f.id === id);
      return folder ? { kind: "folder", id: folder.id, parentId: folder.parentId } : null;
    }
    const id = Number(rawId);
    return Number.isFinite(id) ? { kind: "bookmark", id, parentId: folderId } : null;
  }

  function handleDragStart(event: DragStartEvent) {
    const item = dragItemFor(event.active.id);
    const native = event.activatorEvent as MouseEvent;
    initialPointerRef.current = {
      x: typeof native.clientX === "number" ? native.clientX : 0,
      y: typeof native.clientY === "number" ? native.clientY : 0,
    };
    const domId = item ? itemDomId(item.kind, item.id) : null;
    const el = domId ? document.getElementById(domId) : null;
    setDragPreviewWidth(el ? el.getBoundingClientRect().width : null);
    setActiveItem(item);
    if (item?.kind === "bookmark") {
      const bookmark = orderedBookmarks.find((b) => b.id === item.id);
      setDragOverlaySnapshot(bookmark ? { kind: "bookmark", bookmark, mode } : null);
    } else if (item?.kind === "folder") {
      const folder = orderedFolders.find((f) => f.id === item.id);
      setDragOverlaySnapshot(folder ? { kind: "folder", folder, mode } : null);
    } else {
      setDragOverlaySnapshot(null);
    }
  }

  function handleDragMove(event: DragMoveEvent) {
    if (!activeItem) return;
    const pointerX = initialPointerRef.current.x + event.delta.x;
    const pointerY = initialPointerRef.current.y + event.delta.y;

    const overRaw = event.over?.id ?? null;
    const overBandMore = overRaw === BAND_MORE_DROP_ID;
    const overId = overRaw !== null && !overBandMore ? Number(overRaw) : null;
    const allowed = overId !== null ? isDropAllowed({ active: activeItem, targetFolderId: overId, ancestorIds }) : false;
    setHoverFolder((prev) => {
      if (overId === null) return prev === null ? prev : null;
      if (prev && prev.id === overId && prev.allowed === allowed) return prev;
      return { id: overId, allowed };
    });

    if (overId !== null || overBandMore) {
      dragTrackIdsRef.current = [];
      setInsertionIndex(null);
      setInsertionLineTop(null);
      setInsertionLineVertical(null);
      return;
    }

    const grid = mode === "tiles";
    const prefix = activeItem.kind === "folder" ? "f" : "b";
    const selector =
      activeItem.kind === "folder" ? (grid ? ".folder-grid" : ".rows") : grid ? ".card-grid" : ".rows";
    const { rects, ids } = collectTrackRects(selector, prefix);
    dragTrackIdsRef.current = ids;

    if (rects.length === 0) {
      setInsertionIndex(null);
      setInsertionLineTop(null);
      setInsertionLineVertical(null);
      return;
    }

    const containerEl = document.querySelector<HTMLElement>(selector);
    const containerRect = containerEl?.getBoundingClientRect();

    if (grid) {
      const idx = insertionIndexGrid(rects, pointerX, pointerY);
      setInsertionIndex(idx);
      setInsertionLineTop(null);
      if (idx === null || !containerRect) {
        setInsertionLineVertical(null);
        return;
      }
      if (idx < rects.length) {
        const r = rects[idx];
        setInsertionLineVertical({
          left: (r.left ?? 0) - GRID_GAP / 2 - containerRect.left,
          top: r.top - containerRect.top,
          height: r.height,
        });
      } else {
        const r = rects[rects.length - 1];
        setInsertionLineVertical({
          left: (r.left ?? 0) + (r.width ?? 0) + GRID_GAP / 2 - containerRect.left,
          top: r.top - containerRect.top,
          height: r.height,
        });
      }
    } else {
      const idx = insertionIndexVertical(rects, pointerY);
      setInsertionIndex(idx);
      setInsertionLineVertical(null);
      if (idx === null || !containerRect) {
        setInsertionLineTop(null);
        return;
      }
      const top =
        idx < rects.length
          ? rects[idx].top - containerRect.top
          : rects[rects.length - 1].top + rects[rects.length - 1].height - containerRect.top;
      setInsertionLineTop(top);
    }
  }

  async function commitMoveToTarget(item: DragItem, targetFolderId: number | null) {
    if (item.kind === "bookmark") {
      const bookmark = orderedBookmarks.find((b) => b.id === item.id);
      if (!bookmark || bookmark.folderId === targetFolderId) return;
      const prevFolderId = bookmark.folderId;
      setLocalBookmarkOrder(orderedBookmarks.filter((b) => b.id !== item.id).map((b) => b.id));
      try {
        await api.bookmarkUpdate(
          bookmark.id,
          targetFolderId,
          bookmark.title,
          bookmark.url,
          bookmark.description,
          bookmark.image,
        );
      } catch (err) {
        console.error(err);
        await onReload();
        setLocalBookmarkOrder(null);
        return;
      }
      await onReload();
      setLocalBookmarkOrder(null);
      const targetName = targetFolderId === null ? "Корень" : (folders.find((f) => f.id === targetFolderId)?.name ?? "");
      onMoveToast({
        variant: "moved",
        folderName: targetName,
        undo: () =>
          api.bookmarkUpdate(bookmark.id, prevFolderId, bookmark.title, bookmark.url, bookmark.description, bookmark.image),
      });
      return;
    }

    const folder = orderedFolders.find((f) => f.id === item.id);
    if (!folder || folder.parentId === targetFolderId) return;
    const prevParentId = folder.parentId;
    setLocalFolderOrder(orderedFolders.filter((f) => f.id !== item.id).map((f) => f.id));
    try {
      await api.folderMove(folder.id, targetFolderId);
    } catch (err) {
      console.error(err);
      await onReload();
      setLocalFolderOrder(null);
      return;
    }
    await onReload();
    setLocalFolderOrder(null);
    const targetName = targetFolderId === null ? "Корень" : (folders.find((f) => f.id === targetFolderId)?.name ?? "");
    onMoveToast({
      variant: "moved",
      folderName: targetName,
      undo: () => api.folderMove(folder.id, prevParentId),
    });
  }

  const sortActive = mode === "compact" && Boolean(sortKey);

  async function commitSortedReorder(item: DragItem, nextIds: number[]) {
    const prevSortKey = sortKey;
    const prevSortDir = sortDir;
    const isFolder = item.kind === "folder";
    try {
      await api.itemsReorder(folderId, isFolder ? nextIds : [], isFolder ? [] : nextIds);
    } catch (err) {
      console.error(err);
      return;
    }
    try {
      await api.viewSetSort(folderId, null, null);
    } catch (err) {
      console.error(err);
      return;
    }
    onViewChanged(await api.viewState(folderId));
    if (isFolder) {
      setLocalFolderOrder(nextIds);
    } else {
      setLocalBookmarkOrder(nextIds);
    }
    onMoveToast({
      variant: "sorted",
      undo: async () => {
        await api.viewSetSort(folderId, prevSortKey, prevSortDir);
        onViewChanged(await api.viewState(folderId));
      },
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const item = dragItemFor(event.active.id);
    const overId = hoverFolder?.allowed ? hoverFolder.id : null;
    const ids = dragTrackIdsRef.current;
    const toIndex = insertionIndex;
    const wasSortActive = sortActive;
    resetDragState();
    if (!item) return;
    if (overId !== null) {
      void commitMoveToTarget(item, overId);
      return;
    }
    const fromIndex = ids.indexOf(item.id);
    if (toIndex === null || fromIndex === -1) return;
    const nextIds = reorderIds(ids, fromIndex, toIndex);
    const unchanged = nextIds.every((id, i) => id === ids[i]);
    if (unchanged) return;
    if (wasSortActive) {
      void commitSortedReorder(item, nextIds);
      return;
    }
    if (item.kind === "bookmark") {
      setLocalBookmarkOrder(nextIds);
      api.itemsReorder(folderId, [], nextIds).catch(() => {
        setLocalBookmarkOrder(null);
      });
    } else {
      const fullIds = orderedFolders.map((f) => f.id);
      const hiddenIds = fullIds.slice(ids.length);
      const nextFullIds = [...nextIds, ...hiddenIds];
      setLocalFolderOrder(nextFullIds);
      api.itemsReorder(folderId, nextFullIds, []).catch(() => {
        setLocalFolderOrder(null);
      });
    }
  }

  function bookmarkTitleFor(id: number | undefined): string | null {
    if (id === undefined) return null;
    return orderedBookmarks.find((b) => b.id === id)?.title ?? null;
  }

  function folderNameFor(id: number | undefined): string | null {
    if (id === undefined) return null;
    return orderedFolders.find((f) => f.id === id)?.name ?? null;
  }

  const dragAnnouncements: Announcements = {
    onDragStart({ active }) {
      if (isFolderDragId(active.id)) {
        const name = folderNameFor(folderIdFromDragId(String(active.id)));
        return name ? `Начат перенос папки «${name}»` : "Начат перенос папки";
      }
      const title = bookmarkTitleFor(Number(active.id));
      return title ? `Начат перенос закладки «${title}»` : "Начат перенос закладки";
    },
    onDragOver({ active }) {
      if (isFolderDragId(active.id)) {
        const name = folderNameFor(folderIdFromDragId(String(active.id)));
        return name ? `Папка «${name}» перемещается` : "Папка перемещается";
      }
      const title = bookmarkTitleFor(Number(active.id));
      return title ? `Закладка «${title}» перемещается` : "Закладка перемещается";
    },
    onDragEnd({ active }) {
      if (isFolderDragId(active.id)) {
        const name = folderNameFor(folderIdFromDragId(String(active.id)));
        return name ? `Перенос папки «${name}» завершён` : "Перенос завершён";
      }
      const title = bookmarkTitleFor(Number(active.id));
      return title ? `Перенос закладки «${title}» завершён` : "Перенос завершён";
    },
    onDragCancel({ active }) {
      if (isFolderDragId(active.id)) {
        const name = folderNameFor(folderIdFromDragId(String(active.id)));
        return name ? `Перенос папки «${name}» отменён` : "Перенос отменён";
      }
      const title = bookmarkTitleFor(Number(active.id));
      return title ? `Перенос закладки «${title}» отменён` : "Перенос отменён";
    },
  };

  const activeBookmark = dragOverlaySnapshot?.kind === "bookmark" ? dragOverlaySnapshot.bookmark : null;
  const activeFolder = dragOverlaySnapshot?.kind === "folder" ? dragOverlaySnapshot.folder : null;
  const overlayMode = dragOverlaySnapshot?.mode ?? mode;

  const onPreviewBackfillRef = useRef(onPreviewBackfill);
  onPreviewBackfillRef.current = onPreviewBackfill;

  const onLivenessSweepRef = useRef(onLivenessSweep);
  onLivenessSweepRef.current = onLivenessSweep;

  const queueRef = useRef<ReturnType<typeof createPreviewQueue> | null>(null);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedIdsRef = useRef<Set<number>>(new Set());

  const livenessQueueRef = useRef<ReturnType<typeof createPreviewQueue> | null>(null);

  const livenessObserverRef = useRef<IntersectionObserver | null>(null);
  const livenessObservedIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const queue = createPreviewQueue({
      onFlush: (ids) => onPreviewBackfillRef.current(ids),
    });
    queueRef.current = queue;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const domId = (entry.target as HTMLElement).id;
          if (!domId.startsWith("b")) continue;
          const id = Number(domId.slice(1));
          if (!Number.isFinite(id)) continue;
          if (entry.isIntersecting) {
            queue.observe(id);
          } else {
            queue.unobserve(id);
          }
        }
      },
      { rootMargin: PREVIEW_OBSERVER_ROOT_MARGIN },
    );
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      queue.dispose();
      queueRef.current = null;
    };
  }, []);

  useEffect(() => {
    const observer = observerRef.current;
    const queue = queueRef.current;
    if (!observer || !queue) return;
    observer.disconnect();
    const nextIds = new Set<number>();
    for (const bookmark of bookmarks) {
      if (bookmark.image || bookmark.previewFile || bookmark.previewFetchedAt) continue;
      nextIds.add(bookmark.id);
      const el = document.getElementById(itemDomId("bookmark", bookmark.id));
      if (el) observer.observe(el);
    }
    for (const id of observedIdsRef.current) {
      if (!nextIds.has(id)) queue.unobserve(id);
    }
    observedIdsRef.current = nextIds;
  }, [bookmarks, mode]);

  useEffect(() => {
    const queue = createPreviewQueue({
      onFlush: (ids) => onLivenessSweepRef.current(ids),
    });
    livenessQueueRef.current = queue;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const domId = (entry.target as HTMLElement).id;
          if (!domId.startsWith("b")) continue;
          const id = Number(domId.slice(1));
          if (!Number.isFinite(id)) continue;
          if (entry.isIntersecting) {
            queue.observe(id);
          } else {
            queue.unobserve(id);
          }
        }
      },
      { rootMargin: PREVIEW_OBSERVER_ROOT_MARGIN },
    );
    livenessObserverRef.current = observer;
    return () => {
      observer.disconnect();
      livenessObserverRef.current = null;
      queue.dispose();
      livenessQueueRef.current = null;
    };
  }, []);

  useEffect(() => {
    const observer = livenessObserverRef.current;
    const queue = livenessQueueRef.current;
    if (!observer || !queue) return;
    observer.disconnect();
    const nextIds = new Set<number>();
    for (const bookmark of bookmarks) {
      nextIds.add(bookmark.id);
      const el = document.getElementById(itemDomId("bookmark", bookmark.id));
      if (el) observer.observe(el);
    }
    for (const id of livenessObservedIdsRef.current) {
      if (!nextIds.has(id)) queue.unobserve(id);
    }
    livenessObservedIdsRef.current = nextIds;
  }, [bookmarks, mode]);

  function handleCacheMiss(id: number) {
    onPreviewBackfillRef.current([id], true);
  }

  const onPasteAddRef = useRef(onPasteAdd);
  onPasteAddRef.current = onPasteAdd;

  useEffect(() => {
    function handlePaste(e: globalThis.KeyboardEvent) {
      if (!(e.ctrlKey && e.key.toLowerCase() === "v")) return;
      if (isNativePasteTarget(e.target)) return;
      if (document.querySelector(".modal-backdrop")) return;
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      api.clipboardUrl().then((result) => {
        onPasteAddRef.current(result.url);
      });
    }
    window.addEventListener("keydown", handlePaste);
    return () => window.removeEventListener("keydown", handlePaste);
  }, []);

  function firstUriListLine(raw: string): string {
    const line = raw.split(/\r?\n/).find((candidate) => !candidate.trim().startsWith("#"));
    return line ? line.trim() : "";
  }

  function handleExternalDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (isNativePasteTarget(e.target)) return;
    if (document.querySelector(".modal-backdrop")) return;
    e.preventDefault();
  }

  function handleExternalDrop(e: React.DragEvent<HTMLDivElement>) {
    if (isNativePasteTarget(e.target)) return;
    if (document.querySelector(".modal-backdrop")) return;
    e.preventDefault();
    const uriList = e.dataTransfer.getData("text/uri-list");
    const url = firstUriListLine(uriList || e.dataTransfer.getData("text/plain"));
    if (!url) return;
    onPasteAddRef.current(url);
  }

  const firstItemId =
    orderedFolders.length > 0
      ? itemDomId("folder", orderedFolders[0].id)
      : orderedBookmarks.length > 0
        ? itemDomId("bookmark", orderedBookmarks[0].id)
        : null;

  async function changeMode(next: ViewMode) {
    captureBeforeSwitch();
    await api.viewSetMode(folderId, next);
    onViewChanged(await api.viewState(folderId));
  }

  async function resetOverrides() {
    await api.viewResetOverrides(mode);
    onViewChanged(await api.viewState(folderId));
  }

  async function changeSort(key: SortKey) {
    const nextDir: SortDir = key === sortKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    await api.viewSetSort(folderId, key, nextDir);
    onViewChanged(await api.viewState(folderId));
  }

  const isEmpty = folders.length === 0 && bookmarks.length === 0;
  const showMoreVisible = searchActive && hasMore(bookmarks.length, searchTotal);
  const dropTargetFolderId = hoverFolder?.allowed ? hoverFolder.id : null;
  const noDropFolderId = hoverFolder && !hoverFolder.allowed ? hoverFolder.id : null;
  const dropAnimation = reducedMotion
    ? null
    : {
        duration: durations(false).dragReturn,
        easing: getComputedStyle(document.documentElement).getPropertyValue("--ease-drag-return").trim() || "ease-out",
      };

  const showcaseNode = (
    <div
      className={"showcase" + (activeItem !== null ? " dragging" : "")}
      ref={scrollerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={onFocusWithin}
      onDragOver={handleExternalDragOver}
      onDrop={handleExternalDrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.focus();
      }}
    >
      <ModeSwitch mode={mode} overridesExist={overridesExist} onChangeMode={changeMode} onReset={resetOverrides} />
      <FadeSwap key={navFade ? String(navFade.folderId) : "nav-static"} variant={navFade ? { kind: "nav", direction: navFade.direction } : null}>
      <FadeSwap key={modeFade ? modeFade.mode : "mode-static"} variant={modeFade ? { kind: "mode" } : null}>
      {searchFailed ? (
        <p className="showcase-note search-error">
          Не удалось выполнить поиск ·{" "}
          <button type="button" onClick={onRetrySearch}>
            Повторить
          </button>
        </p>
      ) : searchActive ? (
        <>
          <ResultsSummary
            total={searchTotal}
            totalGlobal={searchTotalGlobal}
            inCurrentFolder={searchInCurrentFolder}
            query={searchQueryText}
            tags={searchTags}
            sort={searchSort}
            onSortChange={onSearchSortChange ?? (() => {})}
            scopeFolderId={searchScopeFolderId}
            currentFolderId={folderId}
            currentFolderName={currentFolderName}
            onNarrowToFolder={onNarrowSearchToFolder ?? (() => {})}
            onEscalateToGlobal={onEscalateSearchToGlobal ?? (() => {})}
            bothEmpty={isEmpty}
          />
          {isEmpty ? null : mode === "tiles" ? (
            <>
              <FoldersSection
                folders={folders}
                folderId={folderId}
                bandCollapsed={bandCollapsed}
                firstItemId={firstItemId}
                folderMatches={searchFolderMatches}
                dragDisabled
                onToggleBandCollapsed={onToggleBandCollapsed}
                onOpenFolder={onOpenFolder}
                onEditFolder={onEditFolder}
                onDeleteFolder={onDeleteFolder}
              />
              <BookmarksSection
                bookmarks={bookmarks}
                highlightBookmarkId={highlightBookmarkId}
                firstItemId={firstItemId}
                previewPendingIds={previewPendingIds}
                searchMode
                highlights={searchHighlights}
                searchTags={searchTags}
                dragDisabled
                onOpenBookmark={onOpenBookmark}
                onEditBookmark={onEditBookmark}
                onDeleteBookmark={onDeleteBookmark}
                onAddBookmark={onAddBookmark}
                onCacheMiss={handleCacheMiss}
              />
            </>
          ) : (
            <RowsSection
              key={folderId ?? "root"}
              folders={folders}
              bookmarks={bookmarks}
              mode={mode}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={changeSort}
              highlightBookmarkId={highlightBookmarkId}
              firstItemId={firstItemId}
              previewPendingIds={previewPendingIds}
              highlights={searchHighlights}
              folderMatches={searchFolderMatches}
              searchTags={searchTags}
              dragDisabled
              onOpenFolder={onOpenFolder}
              onEditFolder={onEditFolder}
              onDeleteFolder={onDeleteFolder}
              onOpenBookmark={onOpenBookmark}
              onEditBookmark={onEditBookmark}
              onDeleteBookmark={onDeleteBookmark}
              onCacheMiss={handleCacheMiss}
            />
          )}
          <ShowMoreButton visible={showMoreVisible} onClick={onShowMoreSearch ?? (() => {})} />
        </>
      ) : isEmpty ? (
        <EmptyFolder
          isRoot={folderId === null}
          onAddBookmark={onAddBookmark}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteCurrentFolder}
        />
      ) : mode === "tiles" ? (
        <>
          <FoldersSection
            folders={orderedFolders}
            folderId={folderId}
            bandCollapsed={bandCollapsed}
            firstItemId={firstItemId}
            insertionLineVertical={activeItem?.kind === "folder" ? insertionLineVertical : null}
            dropTargetFolderId={dropTargetFolderId}
            noDropFolderId={noDropFolderId}
            onToggleBandCollapsed={onToggleBandCollapsed}
            onOpenFolder={onOpenFolder}
            onEditFolder={onEditFolder}
            onDeleteFolder={onDeleteFolder}
          />
          <BookmarksSection
            bookmarks={orderedBookmarks}
            highlightBookmarkId={highlightBookmarkId}
            firstItemId={firstItemId}
            previewPendingIds={previewPendingIds}
            insertionLineVertical={activeItem?.kind === "bookmark" ? insertionLineVertical : null}
            staggerStep={staggerStepValue}
            onOpenBookmark={onOpenBookmark}
            onEditBookmark={onEditBookmark}
            onDeleteBookmark={onDeleteBookmark}
            onAddBookmark={onAddBookmark}
            onCacheMiss={handleCacheMiss}
          />
        </>
      ) : (
        <RowsSection
          key={folderId ?? "root"}
          folders={orderedFolders}
          bookmarks={orderedBookmarks}
          mode={mode}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={changeSort}
          highlightBookmarkId={highlightBookmarkId}
          firstItemId={firstItemId}
          previewPendingIds={previewPendingIds}
          insertionLineTop={insertionLineTop}
          dropTargetFolderId={dropTargetFolderId}
          noDropFolderId={noDropFolderId}
          staggerStep={staggerStepValue}
          onOpenFolder={onOpenFolder}
          onEditFolder={onEditFolder}
          onDeleteFolder={onDeleteFolder}
          onOpenBookmark={onOpenBookmark}
          onEditBookmark={onEditBookmark}
          onDeleteBookmark={onDeleteBookmark}
          onCacheMiss={handleCacheMiss}
        />
      )}
      </FadeSwap>
      </FadeSwap>
    </div>
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDragState}
      accessibility={{ announcements: dragAnnouncements }}
    >
      {showcaseNode}
      <DragOverlay dropAnimation={dropAnimation}>
        {activeBookmark ? (
          <div className="drag-preview" style={dragPreviewWidth ? { width: dragPreviewWidth } : undefined}>
            {overlayMode === "tiles" ? (
              <BookmarkCard
                bookmark={activeBookmark}
                highlighted={false}
                tabIndex={-1}
                dragDisabled
                onOpen={() => {}}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            ) : overlayMode === "compact" ? (
              <CompactRow bookmark={activeBookmark} tabIndex={-1} dragDisabled onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} />
            ) : (
              <ListRow bookmark={activeBookmark} tabIndex={-1} dragDisabled onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} />
            )}
          </div>
        ) : null}
        {activeFolder ? (
          <div className="drag-preview" style={dragPreviewWidth ? { width: dragPreviewWidth } : undefined}>
            {overlayMode === "tiles" ? (
              <FolderTile
                folder={activeFolder}
                tabIndex={-1}
                dragDisabled
                dropDisabled
                onOpen={() => {}}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            ) : (
              <FolderRow
                folder={activeFolder}
                compact={overlayMode === "compact"}
                tabIndex={-1}
                dragDisabled
                dropDisabled
                onOpen={() => {}}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
