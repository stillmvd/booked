import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

import {
  bookmarkCreate,
  bookmarkDelete,
  bookmarkLinksSet,
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
import { AppendLinkForm } from "./AppendLinkForm";
import type { AppendLinkData } from "./AppendLinkForm";
import { BookmarkForm } from "./BookmarkForm";
import type { BookmarkFormData } from "./BookmarkForm";
import { buildPaths } from "./FolderForm";
import { SaveToast } from "./SaveToast";

const SAVE_DELAY_MS = 1200;
const QUICK_ADD_SHOW_EVENT = "quick-add:show";
const ROOT_LABEL = "Booked";

type Mode = "new" | "append";

const MODES: { id: Mode; label: string }[] = [
  { id: "new", label: "Новая закладка" },
  { id: "append", label: "Добавить к закладке" },
];

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
  const [toast, setToast] = useState<{ key: string; text: string } | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const modeRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ new: null, append: null });
  const keepModeFocusRef = useRef(false);
  const activeSaveRef = useRef<string | null>(null);
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
    activeSaveRef.current = null;
    setSaveError(null);
    setToast(null);
    setMode("new");
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
      const content = Math.ceil(el.getBoundingClientRect().height);
      const limit = Math.min(Math.floor(window.screen.availHeight * 0.8), 720);
      const height = Math.min(Math.max(content, 1), limit);
      const win = getCurrentWindow();
      win
        .setSize(new LogicalSize(520, height))
        .then(() => win.center())
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
    activeSaveRef.current = key;
    resolveFolderLabel(data.folderId).then((label) => {
      if (activeSaveRef.current === key) setToast({ key, text: `Сохранено в ${label}` });
    });
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
          previewFetch(id).catch((err) => console.error(err));
          finishSave(key);
        } catch (err) {
          failSave(key, err);
        }
      },
      SAVE_DELAY_MS,
    );
  }

  function finishSave(key: string) {
    if (activeSaveRef.current !== key) return;
    activeSaveRef.current = null;
    setToast(null);
    quickAddSetDirty(false).catch((err) => console.error(err));
    hideWindow();
  }

  function failSave(key: string, err: unknown) {
    if (activeSaveRef.current === key) {
      activeSaveRef.current = null;
      setToast(null);
    }
    setSaveError(userMessage(err));
  }

  function handleCancelSave() {
    if (!toast) return;
    cancel(toast.key);
    activeSaveRef.current = null;
    setToast(null);
    quickAddSetDirty(false).catch((err) => console.error(err));
    hideWindow();
  }

  function handleAppendSubmit(data: AppendLinkData) {
    const key = `append:${data.bookmarkId}:${Date.now()}`;
    activeSaveRef.current = key;
    setSaveError(null);
    setToast({ key, text: `Ссылка добавлена к «${data.title}»` });
    schedule(
      key,
      async () => {
        try {
          await bookmarkLinksSet(data.bookmarkId, data.links);
          finishSave(key);
        } catch (err) {
          failSave(key, err);
        }
      },
      SAVE_DELAY_MS,
    );
  }

  function switchMode(next: Mode) {
    if (next === mode || toast) return;
    setMode(next);
    setSaveError(null);
    handleDirtyChange(false);
  }

  function handleModesKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next: Mode = e.key === "Home" ? "new" : e.key === "End" ? "append" : mode === "new" ? "append" : "new";
    if (next === mode || toast) return;
    keepModeFocusRef.current = true;
    switchMode(next);
    modeRefs.current[next]?.focus();
  }

  useEffect(() => {
    if (!keepModeFocusRef.current) return;
    keepModeFocusRef.current = false;
    modeRefs.current[mode]?.focus();
  }, [mode]);

  return (
    <div className="quick-add-sheet" ref={containerRef}>
      <div className="quick-add-modes" role="radiogroup" aria-label="Что сделать со ссылкой" onKeyDown={handleModesKeyDown}>
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            ref={(el) => {
              modeRefs.current[id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={mode === id}
            tabIndex={mode === id ? 0 : -1}
            className="quick-add-mode"
            onClick={() => switchMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "new" ? (
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
      ) : (
        <AppendLinkForm
          key={resetKey}
          initialUrl={initialUrl}
          urlHint={urlHint}
          externalError={saveError}
          onSubmit={handleAppendSubmit}
          onDirtyChange={handleDirtyChange}
          onNavigateToDuplicate={hideWindow}
          onClose={hideWindow}
        />
      )}
      {toast ? <SaveToast text={toast.text} onCancel={handleCancelSave} /> : null}
    </div>
  );
}
