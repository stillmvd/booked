import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import * as previewApi from "./lib/api";
import {
  bookmarkDelete,
  bookmarkOpen,
  dbStatus,
  folderBreadcrumbs,
  folderChildren,
  folderDelete,
  hotkeyStatus,
  previewFetch,
  searchQuery,
  tagCounts as fetchTagCounts,
  viewSetBandCollapsed,
  viewState,
} from "./lib/api";
import type {
  Bookmark,
  Crumb,
  DbStatus,
  DeleteMode,
  DuplicateHit,
  Folder,
  HotkeyStatus,
  SearchHighlight,
  SearchSort,
  TagCount,
  ViewState,
} from "./lib/types";
import { NO_LINK_HINT } from "./lib/clipboard";
import { cancel, flushAll, pendingKeys, schedule } from "./lib/pendingDeletions";
import { SEARCH_PAGE } from "./lib/searchSummary";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { BookmarkForm } from "./components/BookmarkForm";
import { ClipboardAddButton } from "./components/ClipboardAddButton";
import { DbErrorScreen } from "./components/DbErrorScreen";
import { DeleteToast } from "./components/DeleteToast";
import { FolderDeleteDialog } from "./components/FolderDeleteDialog";
import { FolderForm } from "./components/FolderForm";
import { Modal } from "./components/Modal";
import { SearchField } from "./components/SearchField";
import { Showcase } from "./components/Showcase";
import { TagFilterBar } from "./components/TagFilterBar";

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
  const [deletingFolder, setDeletingFolder] = useState<{ id: number; name: string } | null>(null);
  const [deleteToasts, setDeleteToasts] = useState<DeleteToastEntry[]>([]);
  const [pendingDeleteKeys, setPendingDeleteKeys] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewState | null>(null);
  const [previewPendingIds, setPreviewPendingIds] = useState<Set<number>>(new Set());
  const [hotkeyState, setHotkeyState] = useState<HotkeyStatus | null>(null);
  const [clipboardPrefillUrl, setClipboardPrefillUrl] = useState<string | undefined>(undefined);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Bookmark[]>([]);
  const [searchFolders, setSearchFolders] = useState<Folder[]>([]);
  const [searchHighlights, setSearchHighlights] = useState<Record<number, SearchHighlight>>({});
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchScopeFolderId, setSearchScopeFolderId] = useState<number | null>(null);
  const [searchSort, setSearchSort] = useState<SearchSort>("relevance");
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchTotalGlobal, setSearchTotalGlobal] = useState(0);
  const [searchInCurrentFolder, setSearchInCurrentFolder] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const currentFolderIdRef = useRef(currentFolderId);
  currentFolderIdRef.current = currentFolderId;
  const dbOkRef = useRef(false);
  dbOkRef.current = dbState?.ok ?? false;
  const searchGenerationRef = useRef(0);
  const isSearching = searchText.trim() !== "" || selectedTags.length > 0;

  async function reload(folderId: number | null) {
    const contents = await folderChildren(folderId);
    setFolders(contents.folders);
    setBookmarks(contents.bookmarks);
    setCrumbs(folderId === null ? [] : await folderBreadcrumbs(folderId));
    fetchTagCounts()
      .then(setTagCounts)
      .catch((err) => {
        console.error(err);
        setTagCounts([]);
      });
  }

  useEffect(() => {
    dbStatus().then(setDbState);
    hotkeyStatus().then(setHotkeyState).catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (!dbState?.ok) return;
    reload(currentFolderId);
    viewState(currentFolderId).then(setView);
  }, [currentFolderId, dbState]);

  function runSearch(text: string, options?: { offset?: number; append?: boolean }) {
    const offset = options?.offset ?? 0;
    const append = options?.append ?? false;
    const generation = ++searchGenerationRef.current;
    searchQuery({
      text,
      tags: selectedTags,
      scopeFolderId: searchScopeFolderId,
      currentFolderId,
      sort: searchSort,
      limit: SEARCH_PAGE,
      offset,
    })
      .then((results) => {
        if (searchGenerationRef.current !== generation) return;
        setSearchResults((prev) => (append ? [...prev, ...results.bookmarks] : results.bookmarks));
        setSearchFolders(results.folders);
        const highlightMap: Record<number, SearchHighlight> = {};
        results.bookmarks.forEach((b, i) => {
          highlightMap[b.id] = results.highlights[i];
        });
        setSearchHighlights((prev) => (append ? { ...prev, ...highlightMap } : highlightMap));
        setSearchTotal(results.total);
        setSearchTotalGlobal(results.totalGlobal);
        setSearchInCurrentFolder(results.inCurrentFolder);
        setSearchFailed(false);
      })
      .catch((err) => {
        console.error(err);
        if (searchGenerationRef.current !== generation) return;
        setSearchFailed(true);
      });
  }

  useEffect(() => {
    if (!dbState?.ok) return;
    if (searchText.trim() === "" && selectedTags.length === 0) {
      searchGenerationRef.current += 1;
      setSearchResults([]);
      setSearchFolders([]);
      setSearchHighlights({});
      setSearchFailed(false);
      setSearchScopeFolderId(null);
      setSearchTotal(0);
      setSearchTotalGlobal(0);
      setSearchInCurrentFolder(0);
      return;
    }
    runSearch(searchText);
  }, [searchText, selectedTags, dbState, currentFolderId, searchScopeFolderId, searchSort]);

  useEffect(() => {
    setSearchScopeFolderId(null);
  }, [currentFolderId]);

  function toggleTag(name: string) {
    setSelectedTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }

  function clearTags() {
    setSelectedTags([]);
  }

  function retrySearch() {
    if (!isSearching) return;
    runSearch(searchText);
  }

  function showMoreSearch() {
    if (!isSearching) return;
    runSearch(searchText, { offset: searchResults.length, append: true });
  }

  function narrowSearchToFolder() {
    setSearchScopeFolderId(currentFolderId);
  }

  function escalateSearchToGlobal() {
    setSearchScopeFolderId(null);
  }

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
        await previewApi.previewBackfillCancel().catch((err) => console.error(err));
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused && dbOkRef.current) reload(currentFolderIdRef.current);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  function handleBookmarkCreated(id: number) {
    setPreviewPendingIds((prev) => new Set(prev).add(id));
    previewFetch(id)
      .catch((err) => console.error(err))
      .finally(() => {
        setPreviewPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        reload(currentFolderIdRef.current);
      });
  }

  function handlePreviewBackfill(ids: number[], force = false) {
    setPreviewPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    previewApi.previewBackfill(ids, force)
      .then((items) => {
        if (items.length === 0) return;
        setBookmarks((prev) =>
          prev.map((b) => {
            const item = items.find((i) => i.id === b.id);
            if (!item) return b;
            return {
              ...b,
              previewFile: item.file,
              previewOrigin: item.origin,
              previewFetchedAt: Math.floor(Date.now() / 1000),
            };
          }),
        );
      })
      .catch((err) => console.error(err))
      .finally(() => {
        setPreviewPendingIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      });
  }

  function closeEditingBookmark() {
    setEditingBookmark(null);
    reload(currentFolderId);
  }

  function openQuickCreate(url: string | null) {
    setClipboardPrefillUrl(url ?? undefined);
    setClipboardHint(url ? null : NO_LINK_HINT);
    setCreatingBookmark(true);
  }

  function navigateToDuplicate(hit: DuplicateHit) {
    setHighlightBookmarkId(hit.id);
    setCurrentFolderId(hit.folderId);
  }

  function toggleBandCollapsed() {
    if (!view) return;
    const next = !view.bandCollapsed;
    setView({ ...view, bandCollapsed: next });
    viewSetBandCollapsed(currentFolderId, next).catch((err) => console.error(err));
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
    const isCurrentFolder = folder.id === currentFolderId;
    const parentId = crumbs[crumbs.length - 2]?.id ?? null;
    setDeletingFolder(null);
    if (isCurrentFolder) {
      setCurrentFolderId(parentId);
    }
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
        <div className="app-head-row">
          <Breadcrumbs crumbs={crumbs} onNavigate={setCurrentFolderId} />

          <div className="toolbar">
            <button type="button" className="new-folder-button" onClick={() => setCreating(true)}>
              Новая папка
            </button>
            <button type="button" className="new-folder-button" onClick={() => setCreatingBookmark(true)}>
              Новая закладка
            </button>
            <ClipboardAddButton className="new-folder-button" onAdd={openQuickCreate} />
          </div>
        </div>

        <SearchField value={searchText} onChange={setSearchText} />

        <TagFilterBar
          tagCounts={tagCounts}
          selectedTags={selectedTags}
          onToggleTag={toggleTag}
          onClearTags={clearTags}
        />

        {hotkeyState && !hotkeyState.registered ? (
          <p className="hotkey-conflict">Комбинация {hotkeyState.combo} занята</p>
        ) : null}
      </div>

      <Showcase
        folders={isSearching ? searchFolders : visibleFolders}
        bookmarks={isSearching ? searchResults : visibleBookmarks}
        searchActive={isSearching}
        searchFailed={isSearching && searchFailed}
        onRetrySearch={retrySearch}
        searchQueryText={searchText}
        searchTags={selectedTags}
        searchHighlights={searchHighlights}
        searchSort={searchSort}
        onSearchSortChange={setSearchSort}
        searchScopeFolderId={searchScopeFolderId}
        searchTotal={searchTotal}
        searchTotalGlobal={searchTotalGlobal}
        searchInCurrentFolder={searchInCurrentFolder}
        currentFolderName={currentFolderName}
        onNarrowSearchToFolder={narrowSearchToFolder}
        onEscalateSearchToGlobal={escalateSearchToGlobal}
        onShowMoreSearch={showMoreSearch}
        mode={view?.mode ?? "tiles"}
        overridesExist={view?.overridesExist ?? false}
        onViewChanged={setView}
        folderId={currentFolderId}
        bandCollapsed={view?.bandCollapsed ?? false}
        onToggleBandCollapsed={toggleBandCollapsed}
        onOpenFolder={(folder) => setCurrentFolderId(folder.id)}
        onOpenBookmark={(bookmark) => bookmarkOpen(bookmark.id).catch((err) => console.error(err))}
        onEditFolder={setEditingFolder}
        onDeleteFolder={setDeletingFolder}
        onEditBookmark={setEditingBookmark}
        onDeleteBookmark={handleDeleteBookmark}
        onAddBookmark={() => setCreatingBookmark(true)}
        onCreateFolder={() => setCreating(true)}
        previewPendingIds={previewPendingIds}
        onPasteAdd={openQuickCreate}
        onPreviewBackfill={handlePreviewBackfill}
        onDeleteCurrentFolder={() => {
          if (currentFolderId === null) return;
          setDeletingFolder({ id: currentFolderId, name: currentFolderName ?? "" });
        }}
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
        <Modal
          onClose={() => {
            setCreatingBookmark(false);
            setClipboardPrefillUrl(undefined);
            setClipboardHint(null);
          }}
        >
          <BookmarkForm
            bookmark={null}
            folderId={currentFolderId}
            initialUrl={clipboardPrefillUrl}
            urlHint={clipboardHint}
            autoFocusField={clipboardHint ? "url" : undefined}
            onClose={() => {
              setCreatingBookmark(false);
              setClipboardPrefillUrl(undefined);
              setClipboardHint(null);
            }}
            onSaved={(createdId) => {
              reload(currentFolderId);
              if (createdId !== undefined) handleBookmarkCreated(createdId);
            }}
            onNavigateToDuplicate={navigateToDuplicate}
          />
        </Modal>
      )}

      {editingBookmark && (
        <Modal onClose={closeEditingBookmark}>
          <BookmarkForm
            bookmark={editingBookmark}
            folderId={currentFolderId}
            onClose={closeEditingBookmark}
            onSaved={() => {}}
            onNavigateToDuplicate={navigateToDuplicate}
          />
        </Modal>
      )}
    </div>
  );
}

export default App;
