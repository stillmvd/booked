import { useState } from "react";

import * as api from "../lib/api";
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
}

interface FoldersSectionProps {
  folders: Folder[];
  folderId: number | null;
  bandCollapsed: boolean;
  onToggleBandCollapsed: () => void;
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
}

function FoldersSection({
  folders,
  folderId,
  bandCollapsed,
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
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onAddBookmark: () => void;
}

function BookmarksSection({
  bookmarks,
  highlightBookmarkId,
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
  onAddBookmark,
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
            onOpen={() => onOpenBookmark(bookmark)}
            onEdit={() => onEditBookmark(bookmark)}
            onDelete={() => onDeleteBookmark(bookmark)}
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
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
}

function RowsSection({
  folders,
  bookmarks,
  mode,
  highlightBookmarkId,
  onOpenFolder,
  onEditFolder,
  onDeleteFolder,
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
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
            onOpen={() => onOpenBookmark(bookmark)}
            onEdit={() => onEditBookmark(bookmark)}
            onDelete={() => onDeleteBookmark(bookmark)}
          />
        ) : (
          <ListRow
            key={bookmark.id}
            bookmark={bookmark}
            highlighted={highlightBookmarkId === bookmark.id}
            onOpen={() => onOpenBookmark(bookmark)}
            onEdit={() => onEditBookmark(bookmark)}
            onDelete={() => onDeleteBookmark(bookmark)}
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
  } = props;

  const { scrollerRef, captureBeforeSwitch } = useShowcaseNav(mode);

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
    <div className="showcase" ref={scrollerRef}>
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
            onToggleBandCollapsed={onToggleBandCollapsed}
            onOpenFolder={onOpenFolder}
            onEditFolder={onEditFolder}
            onDeleteFolder={onDeleteFolder}
          />
          <BookmarksSection
            bookmarks={bookmarks}
            highlightBookmarkId={highlightBookmarkId}
            onOpenBookmark={onOpenBookmark}
            onEditBookmark={onEditBookmark}
            onDeleteBookmark={onDeleteBookmark}
            onAddBookmark={onAddBookmark}
          />
        </>
      ) : (
        <RowsSection
          key={folderId ?? "root"}
          folders={folders}
          bookmarks={bookmarks}
          mode={mode}
          highlightBookmarkId={highlightBookmarkId}
          onOpenFolder={onOpenFolder}
          onEditFolder={onEditFolder}
          onDeleteFolder={onDeleteFolder}
          onOpenBookmark={onOpenBookmark}
          onEditBookmark={onEditBookmark}
          onDeleteBookmark={onDeleteBookmark}
        />
      )}
    </div>
  );
}
