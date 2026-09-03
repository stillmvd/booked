import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

import {
  bookmarkCreate,
  bookmarkDelete,
  bookmarkSetBrowser,
  bookmarkSetTags,
  clipboardUrl,
  folderListAll,
  previewFetch,
  quickAddSetDirty,
  settingsRead,
} from "../lib/api";
import { NO_LINK_HINT } from "../lib/clipboard";
import { cancel, schedule } from "../lib/pendingDeletions";
import { applyTheme, useTheme } from "../lib/theme";
import type { Theme } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { BookmarkForm } from "./BookmarkForm";
import type { BookmarkFormData } from "./BookmarkForm";
import { buildPaths } from "./FolderForm";
import { SaveToast } from "./SaveToast";

const SAVE_DELAY_MS = 1200;
const QUICK_ADD_SHOW_EVENT = "quick-add:show";
const ROOT_LABEL = "Booked";

function hideWindow() {
  getCurrentWindow()
    .hide()
    .catch((err) => console.error(err));
}

export function QuickAddWindow() {
  const [themePref, setThemePref] = useState<Theme>("system");
  applyTheme(useTheme(themePref));
  const [initialUrl, setInitialUrl] = useState("");
  const [urlHint, setUrlHint] = useState<string | null>(null);
  const [autoFocusField, setAutoFocusField] = useState<"url" | "title">("url");
  const [resetKey, setResetKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: string; label: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function loadTheme() {
      settingsRead()
        .then((settings) => setThemePref(settings.theme))
        .catch((err) => console.error(err));
    }
    loadTheme();
    const unlistenPromise = listen(QUICK_ADD_SHOW_EVENT, loadTheme);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function loadClipboard() {
    const result = await clipboardUrl();
    if (result.url) {
      setInitialUrl(result.url);
      setUrlHint(null);
      setAutoFocusField("title");
    } else {
      setInitialUrl("");
      setUrlHint(NO_LINK_HINT);
      setAutoFocusField("url");
    }
    setSaveError(null);
    setToast(null);
    setResetKey((k) => k + 1);
  }

  useEffect(() => {
    loadClipboard();
    const unlistenPromise = listen(QUICK_ADD_SHOW_EVENT, () => {
      loadClipboard();
    });
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") hideWindow();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      getCurrentWindow()
        .setSize(new LogicalSize(520, Math.max(height, 1)))
        .catch((err) => console.error(err));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleDirtyChange(dirty: boolean) {
    quickAddSetDirty(dirty).catch((err) => console.error(err));
  }

  async function resolveFolderLabel(folderId: number | null): Promise<string> {
    if (folderId === null) return ROOT_LABEL;
    const refs = await folderListAll();
    return buildPaths(refs).get(folderId) ?? ROOT_LABEL;
  }

  function handleDeferSubmit(data: BookmarkFormData) {
    const key = `save:${data.url}`;
    resolveFolderLabel(data.folderId).then((label) => setToast({ key, label }));
    schedule(
      key,
      async () => {
        try {
          const id = await bookmarkCreate(
            data.folderId,
            data.title,
            data.url,
            data.description,
            data.image,
          );
          try {
            await bookmarkSetTags(id, data.tags);
            await bookmarkSetBrowser(id, data.browser, data.profile, data.profileName);
          } catch (err) {
            await bookmarkDelete(id).catch((cleanupErr) => console.error(cleanupErr));
            throw err;
          }
          setToast(null);
          quickAddSetDirty(false).catch((err) => console.error(err));
          hideWindow();
          previewFetch(id).catch((err) => console.error(err));
        } catch (err) {
          setToast(null);
          setSaveError(userMessage(err));
        }
      },
      SAVE_DELAY_MS,
    );
  }

  function handleCancelSave() {
    if (!toast) return;
    cancel(toast.key);
    setToast(null);
    quickAddSetDirty(false).catch((err) => console.error(err));
    hideWindow();
  }

  return (
    <div className="quick-add-sheet" ref={containerRef}>
      <BookmarkForm
        key={resetKey}
        bookmark={null}
        folderId={null}
        compact
        initialUrl={initialUrl}
        urlHint={urlHint}
        autoFocusField={autoFocusField}
        onDirtyChange={handleDirtyChange}
        deferSubmit={handleDeferSubmit}
        externalError={saveError}
        onClose={hideWindow}
        onSaved={() => {}}
        onNavigateToDuplicate={hideWindow}
      />
      {toast ? <SaveToast folderLabel={toast.label} onCancel={handleCancelSave} /> : null}
    </div>
  );
}
