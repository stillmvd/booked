import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  bookmarkDelete,
  bookmarkOpen,
  dbStatus,
  folderBreadcrumbs,
  folderChildren,
  folderDelete,
  viewState,
} from "./lib/api";
import type { Bookmark, Crumb, DbStatus, DeleteMode, DuplicateHit, Folder, ViewState } from "./lib/types";
import { cancel, flushAll, pendingKeys, schedule } from "./lib/pendingDeletions";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { BookmarkForm } from "./components/BookmarkForm";
import { DbErrorScreen } from "./components/DbErrorScreen";
import { DeleteToast } from "./components/DeleteToast";
import { FolderDeleteDialog } from "./components/FolderDeleteDialog";
import { FolderForm } from "./components/FolderForm";
import { Modal } from "./components/Modal";
import { Showcase } from "./components/Showcase";

interface DeleteToastEntry {
  key: string;
  label: string;
}

function App() {
  const [dbState, setDbState] = useState<DbStatus | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [creatingBookmark, setCreatingBookmark] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [highlightBookmarkId, setHighlightBookmarkId] = useState<number | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
  const [deleteToasts, setDeleteToasts] = useState<DeleteToastEntry[]>([]);
  const [pendingDeleteKeys, setPendingDeleteKeys] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewState | null>(null);
  const currentFolderIdRef = useRef(currentFolderId);
  currentFolderIdRef.current = currentFolderId;

  async function reload(folderId: number | null) {
    const contents = await folderChildren(folderId);
    setFolders(contents.folders);
    setBookmarks(contents.bookmarks);
    setCrumbs(folderId === null ? [] : await folderBreadcrumbs(folderId));
  }

  useEffect(() => {
    dbStatus().then(setDbState);
  }, []);

  useEffect(() => {
    if (!dbState?.ok) return;
    reload(currentFolderId);
    viewState(currentFolderId).then(setView);
  }, [currentFolderId, dbState]);

  useEffect(() => {
    if (highlightBookmarkId === null) return;
    const timer = setTimeout(() => setHighlightBookmarkId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightBookmarkId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await flushAll();
        await getCurrentWindow().destroy();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  function navigateToDuplicate(hit: DuplicateHit) {
    setHighlightBookmarkId(hit.id);
    setCurrentFolderId(hit.folderId);
  }

  function startDelete(key: string, label: string, run: () => Promise<void>) {
    schedule(key, async () => {
      try {
        await run();
      } catch (err) {
        console.error(err);
      } finally {
        setPendingDeleteKeys(pendingKeys());
        setDeleteToasts((prev) => prev.filter((t) => t.key !== key));
        reload(currentFolderIdRef.current);
      }
    });
    setPendingDeleteKeys(pendingKeys());
    setDeleteToasts((prev) => [...prev, { key, label }]);
  }

  function cancelDelete(key: string) {
    cancel(key);
    setPendingDeleteKeys(pendingKeys());
    setDeleteToasts((prev) => prev.filter((t) => t.key !== key));
  }

  function handleDeleteBookmark(bookmark: Bookmark) {
    startDelete(`bookmark:${bookmark.id}`, bookmark.title, () => bookmarkDelete(bookmark.id));
  }

  function handleConfirmFolderDelete(mode: DeleteMode) {
    if (!deletingFolder) return;
    const folder = deletingFolder;
    setDeletingFolder(null);
    startDelete(`folder:${folder.id}`, folder.name, () => folderDelete(folder.id, mode));
  }

  const currentFolderName = crumbs.length > 0 ? crumbs[crumbs.length - 1].name : null;
  const visibleFolders = folders.filter((f) => !pendingDeleteKeys.has(`folder:${f.id}`));
  const visibleBookmarks = bookmarks.filter((b) => !pendingDeleteKeys.has(`bookmark:${b.id}`));

  if (dbState === null) {
    return null;
  }

  if (!dbState.ok) {
    return (
      <DbErrorScreen
        path={dbState.path ?? ""}
        message={dbState.message ?? ""}
        onRecovered={() => dbStatus().then(setDbState)}
      />
    );
  }

  return (
    <div className="app">
      <div className="app-head">
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
      </div>

      <Showcase
        folders={visibleFolders}
        bookmarks={visibleBookmarks}
        mode={view?.mode ?? "tiles"}
        folderId={currentFolderId}
        onOpenFolder={(folder) => setCurrentFolderId(folder.id)}
        onOpenBookmark={(bookmark) => bookmarkOpen(bookmark.id).catch((err) => console.error(err))}
        onEditFolder={setEditingFolder}
        onDeleteFolder={setDeletingFolder}
        onEditBookmark={setEditingBookmark}
        onDeleteBookmark={handleDeleteBookmark}
        highlightBookmarkId={highlightBookmarkId}
      />

      <div className="delete-toast-stack">
        {deleteToasts.map((toast) => (
          <DeleteToast key={toast.key} label={toast.label} onCancel={() => cancelDelete(toast.key)} />
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

      {deletingFolder && (
        <Modal onClose={() => setDeletingFolder(null)}>
          <FolderDeleteDialog
            folder={deletingFolder}
            parentName={currentFolderName}
            onClose={() => setDeletingFolder(null)}
            onConfirm={handleConfirmFolderDelete}
          />
        </Modal>
      )}

      {creatingBookmark && (
        <Modal onClose={() => setCreatingBookmark(false)}>
          <BookmarkForm
            bookmark={null}
            folderId={currentFolderId}
            onClose={() => setCreatingBookmark(false)}
            onSaved={() => reload(currentFolderId)}
            onNavigateToDuplicate={navigateToDuplicate}
          />
        </Modal>
      )}

      {editingBookmark && (
        <Modal onClose={() => setEditingBookmark(null)}>
          <BookmarkForm
            bookmark={editingBookmark}
            folderId={currentFolderId}
            onClose={() => setEditingBookmark(null)}
            onSaved={() => reload(currentFolderId)}
            onNavigateToDuplicate={navigateToDuplicate}
          />
        </Modal>
      )}
    </div>
  );
}

export default App;
