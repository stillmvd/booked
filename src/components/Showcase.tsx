import type { Bookmark, Folder, ViewMode } from "../lib/types";
import { BookmarkCard } from "./BookmarkCard";
import { FoldersBand } from "./FoldersBand";

export interface ShowcaseProps {
  folders: Folder[];
  bookmarks: Bookmark[];
  mode: ViewMode;
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
  folders: Folder[];
  bookmarks: Bookmark[];
  highlightBookmarkId: number | null;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onAddBookmark: () => void;
}

function BookmarksSection({
  folders,
  bookmarks,
  highlightBookmarkId,
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
  onAddBookmark,
}: BookmarksSectionProps) {
  if (bookmarks.length === 0) {
    if (folders.length === 0) return null;
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
    highlightBookmarkId,
  } = props;

  return (
    <div className="showcase">
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
        folders={folders}
        bookmarks={bookmarks}
        highlightBookmarkId={highlightBookmarkId}
        onOpenBookmark={onOpenBookmark}
        onEditBookmark={onEditBookmark}
        onDeleteBookmark={onDeleteBookmark}
        onAddBookmark={onAddBookmark}
      />
    </div>
  );
}
