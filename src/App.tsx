import { useEffect, useState } from "react";

import { folderBreadcrumbs, folderChildren } from "./lib/api";
import type { Bookmark, Crumb, Folder } from "./lib/types";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { FolderForm } from "./components/FolderForm";
import { Modal } from "./components/Modal";

function App() {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);

  async function reload(folderId: number | null) {
    const contents = await folderChildren(folderId);
    setFolders(contents.folders);
    setBookmarks(contents.bookmarks);
    setCrumbs(folderId === null ? [] : await folderBreadcrumbs(folderId));
  }

  useEffect(() => {
    reload(currentFolderId);
  }, [currentFolderId]);

  return (
    <div className="app">
      <h1>Trove</h1>
      <Breadcrumbs crumbs={crumbs} onNavigate={setCurrentFolderId} />

      <button type="button" className="new-folder-button" onClick={() => setCreating(true)}>
        Новая папка
      </button>

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
          <div className="list-item" key={bookmark.id}>
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
    </div>
  );
}

export default App;
