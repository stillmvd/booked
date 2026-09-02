import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { backupImport, backupInspect } from "../lib/api";
import { longWithTimeRu } from "../lib/dates";
import { pluralizeRu } from "../lib/pluralizeRu";
import type { ImportInspection, ImportMode } from "../lib/types";

interface ImportDialogProps {
  path: string;
  onClose: () => void;
  onImported: (applied: { folders: number; bookmarks: number }) => void;
}

const FILTERS = [{ name: "Выгрузка Trove", extensions: ["json"] }];

function folderWord(n: number): string {
  return pluralizeRu(n, ["папка", "папки", "папок"]);
}

function bookmarkWord(n: number): string {
  return pluralizeRu(n, ["закладка", "закладки", "закладок"]);
}

export function ImportDialog({ path: initialPath, onClose, onImported }: ImportDialogProps) {
  const [path, setPath] = useState(initialPath);
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInspection(null);
    setApplyError(null);
    backupInspect(path)
      .then((result) => {
        if (!cancelled) setInspection(result);
      })
      .catch(() => {
        if (!cancelled) {
          setInspection({
            ok: false,
            fileName: null,
            summary: null,
            currentFolders: null,
            currentBookmarks: null,
            error: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  async function handlePickAnother() {
    const picked = await open({ multiple: false, filters: FILTERS });
    if (!picked || Array.isArray(picked)) return;
    setPath(picked);
  }

  async function handleApply(mode: ImportMode) {
    if (busy || !inspection?.summary) return;
    setBusy(true);
    setApplyError(null);
    try {
      await backupImport(path, mode);
      onImported({ folders: inspection.summary.folders, bookmarks: inspection.summary.bookmarks });
      onClose();
    } catch (err) {
      setApplyError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="import-dialog">
      {loading && <p>Читаем файл…</p>}

      {!loading && inspection?.ok && inspection.summary && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleApply("merge");
          }}
        >
          <div className="import-summary">
            <p>Файл: {inspection.fileName}</p>
            <p>Снят: {longWithTimeRu(inspection.summary.exportedAt)}</p>
            <p>
              В файле: {inspection.summary.folders} {folderWord(inspection.summary.folders)},{" "}
              {inspection.summary.bookmarks} {bookmarkWord(inspection.summary.bookmarks)}
            </p>
            <p>
              Сейчас в базе: {inspection.currentFolders} {folderWord(inspection.currentFolders ?? 0)},{" "}
              {inspection.currentBookmarks} {bookmarkWord(inspection.currentBookmarks ?? 0)}
            </p>
          </div>

          <p className="import-replace-warning">
            Заменить всё сотрёт текущую базу — {inspection.currentFolders}{" "}
            {folderWord(inspection.currentFolders ?? 0)} и {inspection.currentBookmarks}{" "}
            {bookmarkWord(inspection.currentBookmarks ?? 0)}, которые в ней сейчас
          </p>

          {applyError && <p className="form-error">{applyError}</p>}

          <div className="form-actions">
            <button
              type="button"
              className="danger-button"
              aria-busy={busy}
              disabled={busy}
              onClick={() => handleApply("replace")}
            >
              Заменить всё
            </button>
            <button type="submit" aria-busy={busy} disabled={busy}>
              Слить с текущим
            </button>
          </div>
        </form>
      )}

      {!loading && inspection && !inspection.ok && (
        <div className="import-reject-body">
          <p className="import-reject">Этот файл не похож на выгрузку Trove</p>
          <div className="form-actions">
            <button type="button" onClick={handlePickAnother}>
              Выбрать другой файл
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
