import * as api from "../lib/api";
import type { Bookmark, Folder, ViewMode, ViewState } from "../lib/types";
import { BookmarkCard } from "./BookmarkCard";
import { EmptyFolder } from "./EmptyFolder";
import { FoldersBand } from "./FoldersBand";
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

  async function changeMode(next: ViewMode) {
    await api.viewSetMode(folderId, next);
    onViewChanged(await api.viewState(folderId));
  }

  async function resetOverrides() {
    await api.viewResetOverrides(mode);
    onViewChanged(await api.viewState(folderId));
  }

  const isEmpty = folders.length === 0 && bookmarks.length === 0;

  return (
    <div className="showcase">
      <ModeSwitch mode={mode} overridesExist={overridesExist} onChangeMode={changeMode} onReset={resetOverrides} />
      {isEmpty ? (
        <EmptyFolder
          isRoot={folderId === null}
          onAddBookmark={onAddBookmark}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteCurrentFolder}
        />
      ) : (
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
      )}
    </div>
  );
}
