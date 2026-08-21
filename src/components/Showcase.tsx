import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import * as api from "../lib/api";
import { itemDomId } from "../lib/itemDomId";
import { createPreviewQueue } from "../lib/previewQueue";
import { sortBookmarks, sortFolders } from "../lib/sortRows";
import type { SortDir, SortKey } from "../lib/sortRows";
import type { Bookmark, Folder, ViewMode, ViewState } from "../lib/types";
import { useShowcaseNav } from "../lib/useShowcaseNav";
import { BookmarkCard } from "./BookmarkCard";
import { CompactHead } from "./CompactHead";
import { CompactRow } from "./CompactRow";
import { EmptyFolder } from "./EmptyFolder";
import { FolderRow } from "./FolderRow";
import { FoldersBand } from "./FoldersBand";
import { ListRow } from "./ListRow";
import { ModeSwitch } from "./ModeSwitch";

const PREVIEW_OBSERVER_ROOT_MARGIN = "200px";

export interface ShowcaseProps {
  folders: Folder[];
  bookmarks: Bookmark[];
  mode: ViewMode;
  overridesExist: boolean;
  onViewChanged: (view: ViewState) => void;
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
  onPasteAdd: (url: string) => void;
  onPreviewBackfill: (ids: number[], force?: boolean) => void;
}

const PASTE_NATIVE_TARGETS = "INPUT, TEXTAREA, [contenteditable]";

function isNativePasteTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest(PASTE_NATIVE_TARGETS));
}

interface FoldersSectionProps {
  folders: Folder[];
  folderId: number | null;
  bandCollapsed: boolean;
  firstItemId: string | null;
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
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
  onAddBookmark,
  onCacheMiss,
}: BookmarksSectionProps) {
  if (bookmarks.length === 0) {
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
        {bookmarks.map((bookmark) => (
          <BookmarkCard
            key={bookmark.id}
            bookmark={bookmark}
            highlighted={highlightBookmarkId === bookmark.id}
            tabIndex={itemDomId("bookmark", bookmark.id) === firstItemId ? 0 : -1}
            previewPending={previewPendingIds.has(bookmark.id)}
            onOpen={() => onOpenBookmark(bookmark)}
            onEdit={() => onEditBookmark(bookmark)}
            onDelete={() => onDeleteBookmark(bookmark)}
            onCacheMiss={onCacheMiss}
          />
        ))}
      </div>
    </div>
  );
}

interface RowsSectionProps {
  folders: Folder[];
  bookmarks: Bookmark[];
  mode: ViewMode;
  highlightBookmarkId: number | null;
  firstItemId: string | null;
  previewPendingIds: Set<number>;
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onCacheMiss: (id: number) => void;
}

function RowsSection({
  folders,
  bookmarks,
  mode,
  highlightBookmarkId,
  firstItemId,
  previewPendingIds,
  onOpenFolder,
  onEditFolder,
  onDeleteFolder,
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
  onCacheMiss,
}: RowsSectionProps) {
  const compact = mode === "compact";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedFolders = compact && sortKey ? sortFolders(folders, sortKey, sortDir) : folders;
  const sortedBookmarks = compact && sortKey ? sortBookmarks(bookmarks, sortKey, sortDir) : bookmarks;

  return (
    <div className="rows">
      {compact && <CompactHead sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
      {sortedFolders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          compact={compact}
          tabIndex={itemDomId("folder", folder.id) === firstItemId ? 0 : -1}
          onOpen={() => onOpenFolder(folder)}
          onEdit={() => onEditFolder(folder)}
          onDelete={() => onDeleteFolder(folder)}
        />
      ))}
      {sortedBookmarks.map((bookmark) =>
        compact ? (
          <CompactRow
            key={bookmark.id}
            bookmark={bookmark}
            highlighted={highlightBookmarkId === bookmark.id}
            tabIndex={itemDomId("bookmark", bookmark.id) === firstItemId ? 0 : -1}
            previewPending={previewPendingIds.has(bookmark.id)}
            onOpen={() => onOpenBookmark(bookmark)}
            onEdit={() => onEditBookmark(bookmark)}
            onDelete={() => onDeleteBookmark(bookmark)}
            onCacheMiss={onCacheMiss}
          />
        ) : (
          <ListRow
            key={bookmark.id}
            bookmark={bookmark}
            highlighted={highlightBookmarkId === bookmark.id}
            tabIndex={itemDomId("bookmark", bookmark.id) === firstItemId ? 0 : -1}
            previewPending={previewPendingIds.has(bookmark.id)}
            onOpen={() => onOpenBookmark(bookmark)}
            onEdit={() => onEditBookmark(bookmark)}
            onDelete={() => onDeleteBookmark(bookmark)}
            onCacheMiss={onCacheMiss}
          />
        ),
      )}
    </div>
  );
}

export function Showcase(props: ShowcaseProps) {
  const {
    folders,
    bookmarks,
    mode,
    overridesExist,
    onViewChanged,
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
  } = props;

  const { scrollerRef, captureBeforeSwitch, onKeyDown, onFocusWithin } = useShowcaseNav(mode);

  const onPreviewBackfillRef = useRef(onPreviewBackfill);
  onPreviewBackfillRef.current = onPreviewBackfill;

  const queueRef = useRef<ReturnType<typeof createPreviewQueue> | null>(null);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedIdsRef = useRef<Set<number>>(new Set());

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

  function handleCacheMiss(id: number) {
    onPreviewBackfillRef.current([id], true);
  }

  function handlePasteKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!(e.ctrlKey && e.key.toLowerCase() === "v")) return;
    if (isNativePasteTarget(e.target)) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    api.clipboardUrl().then((result) => {
      if (result.url) onPasteAdd(result.url);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    handlePasteKeyDown(e);
    onKeyDown(e);
  }

  const firstItemId =
    folders.length > 0
      ? itemDomId("folder", folders[0].id)
      : bookmarks.length > 0
        ? itemDomId("bookmark", bookmarks[0].id)
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

  const isEmpty = folders.length === 0 && bookmarks.length === 0;

  return (
    <div
      className="showcase"
      ref={scrollerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocus={onFocusWithin}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.focus();
      }}
    >
      <ModeSwitch mode={mode} overridesExist={overridesExist} onChangeMode={changeMode} onReset={resetOverrides} />
      {isEmpty ? (
        <EmptyFolder
          isRoot={folderId === null}
          onAddBookmark={onAddBookmark}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteCurrentFolder}
        />
      ) : mode === "tiles" ? (
        <>
          <FoldersSection
            folders={folders}
            folderId={folderId}
            bandCollapsed={bandCollapsed}
            firstItemId={firstItemId}
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
          highlightBookmarkId={highlightBookmarkId}
          firstItemId={firstItemId}
          previewPendingIds={previewPendingIds}
          onOpenFolder={onOpenFolder}
          onEditFolder={onEditFolder}
          onDeleteFolder={onDeleteFolder}
          onOpenBookmark={onOpenBookmark}
          onEditBookmark={onEditBookmark}
          onDeleteBookmark={onDeleteBookmark}
          onCacheMiss={handleCacheMiss}
        />
      )}
    </div>
  );
}
