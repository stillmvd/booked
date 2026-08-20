import type { Bookmark, Folder, ViewMode } from "../lib/types";
import { BookmarkCard } from "./BookmarkCard";
import { FolderTile } from "./FolderTile";

export interface ShowcaseProps {
  folders: Folder[];
  bookmarks: Bookmark[];
  mode: ViewMode;
  folderId: number | null;
  onOpenFolder: (folder: Folder) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  highlightBookmarkId: number | null;
}

interface FoldersSectionProps {
  folders: Folder[];
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
}

function FoldersSection({ folders, onOpenFolder, onEditFolder, onDeleteFolder }: FoldersSectionProps) {
  if (folders.length === 0) return null;
  return (
    <div className="folders-section">
      <button type="button" className="band-head">
        <span className="chev">▾</span>
        <span>Папки · {folders.length}</span>
      </button>
      <div className="folder-grid">
        {folders.map((folder) => (
          <FolderTile
            key={folder.id}
            folder={folder}
            onOpen={() => onOpenFolder(folder)}
            onEdit={() => onEditFolder(folder)}
            onDelete={() => onDeleteFolder(folder)}
          />
        ))}
      </div>
    </div>
  );
}

interface BookmarksSectionProps {
  bookmarks: Bookmark[];
  highlightBookmarkId: number | null;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
}

function BookmarksSection({
  bookmarks,
  highlightBookmarkId,
  onOpenBookmark,
  onEditBookmark,
  onDeleteBookmark,
}: BookmarksSectionProps) {
  if (bookmarks.length === 0) return null;
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
    onOpenFolder,
    onOpenBookmark,
    onEditFolder,
    onDeleteFolder,
    onEditBookmark,
    onDeleteBookmark,
    highlightBookmarkId,
  } = props;

  return (
    <div className="showcase">
      <FoldersSection
        folders={folders}
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
      />
    </div>
  );
}
