import { useEffect, useState } from "react";

import { folderChildren, folderCreate } from "./lib/api";
import type { Bookmark, Folder } from "./lib/types";
import { DragSpike } from "./spike/DragSpike";

function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [name, setName] = useState("");

  async function reload() {
    const contents = await folderChildren(null);
    setFolders(contents.folders);
    setBookmarks(contents.bookmarks);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await folderCreate(trimmed, null);
    setName("");
    await reload();
  }

  return (
    <div className="app">
      <h1>Trove</h1>

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
          <div className="list-item" key={folder.id}>
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

      <DragSpike />
    </div>
  );
}

export default App;
