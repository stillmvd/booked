import { useEffect, useState } from "react";

import { bookmarkOpen, folderBreadcrumbs, folderChildren } from "./lib/api";
import type { Bookmark, Crumb, DuplicateHit, Folder } from "./lib/types";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { BookmarkForm } from "./components/BookmarkForm";
import { FolderForm } from "./components/FolderForm";
import { Modal } from "./components/Modal";

function App() {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [creatingBookmark, setCreatingBookmark] = useState(false);
  const [highlightBookmarkId, setHighlightBookmarkId] = useState<number | null>(null);

  async function reload(folderId: number | null) {
    const contents = await folderChildren(folderId);
    setFolders(contents.folders);
    setBookmarks(contents.bookmarks);
    setCrumbs(folderId === null ? [] : await folderBreadcrumbs(folderId));
  }

  useEffect(() => {
    reload(currentFolderId);
  }, [currentFolderId]);

  useEffect(() => {
    if (highlightBookmarkId === null) return;
    const timer = setTimeout(() => setHighlightBookmarkId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightBookmarkId]);

  function navigateToDuplicate(hit: DuplicateHit) {
    setHighlightBookmarkId(hit.id);
    setCurrentFolderId(hit.folderId);
  }

  return (
    <div className="app">
      <h1>Trove</h1>
      <Breadcrumbs crumbs={crumbs} onNavigate={setCurrentFolderId} />

      <div className="toolbar">
        <button type="button" className="new-folder-button" onClick={() => setCreating(true)}>
          Новая папка
        </button>
        <button type="button" className="new-folder-button" onClick={() => setCreatingBookmark(true)}>
          Новая закладка
        </button>
      </div>

      <div className="list">
        <h2>Папки</h2>
        {folders.length === 0 && <p className="empty">Пока пусто</p>}
        {folders.map((folder) => (
          <div className="list-item list-item-folder" key={folder.id}>
            <span className="list-item-name" onClick={() => setCurrentFolderId(folder.id)}>
              {folder.name}
            </span>
            <button
              type="button"
              className="list-item-edit"
              onClick={(e) => {
                e.stopPropagation();
                setEditingFolder(folder);
              }}
              aria-label={`Свойства папки ${folder.name}`}
            >
              ✎
            </button>
          </div>
        ))}
      </div>

      <div className="list">
        <h2>Закладки</h2>
        {bookmarks.length === 0 && <p className="empty">Пока пусто</p>}
        {bookmarks.map((bookmark) => (
          <div
            className={
              "list-item list-item-bookmark" +
              (highlightBookmarkId === bookmark.id ? " list-item-highlight" : "")
            }
            key={bookmark.id}
            onClick={() => bookmarkOpen(bookmark.id).catch((err) => console.error(err))}
            role="button"
            tabIndex={0}
          >
            {bookmark.title}
          </div>
        ))}
      </div>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <FolderForm
            folder={null}
            parentId={currentFolderId}
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

      {creatingBookmark && (
        <Modal onClose={() => setCreatingBookmark(false)}>
          <BookmarkForm
            folderId={currentFolderId}
            onClose={() => setCreatingBookmark(false)}
            onSaved={() => reload(currentFolderId)}
            onNavigateToDuplicate={navigateToDuplicate}
          />
        </Modal>
      )}
    </div>
  );
}

export default App;
