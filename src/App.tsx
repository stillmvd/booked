import { useEffect, useState } from "react";

import { folderBreadcrumbs, folderChildren, folderCreate } from "./lib/api";
import type { Bookmark, Crumb, Folder } from "./lib/types";
import { Breadcrumbs } from "./components/Breadcrumbs";

function App() {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [name, setName] = useState("");

  async function reload(folderId: number | null) {
    const contents = await folderChildren(folderId);
    setFolders(contents.folders);
    setBookmarks(contents.bookmarks);
    setCrumbs(folderId === null ? [] : await folderBreadcrumbs(folderId));
  }

  useEffect(() => {
    reload(currentFolderId);
  }, [currentFolderId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await folderCreate(trimmed, currentFolderId);
    setName("");
    await reload(currentFolderId);
  }

  return (
    <div className="app">
      <h1>Trove</h1>
      <Breadcrumbs crumbs={crumbs} onNavigate={setCurrentFolderId} />

      <form className="create-folder" onSubmit={handleCreate}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название папки"
        />
        <button type="submit">Новая папка</button>
      </form>

      <div className="list">
        <h2>Папки</h2>
        {folders.length === 0 && <p className="empty">Пока пусто</p>}
        {folders.map((folder) => (
          <div
            className="list-item list-item-folder"
            key={folder.id}
            onClick={() => setCurrentFolderId(folder.id)}
          >
            {folder.name}
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
    </div>
  );
}

export default App;
