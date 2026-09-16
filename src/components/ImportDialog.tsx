import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { backupAutoExport, backupImport, backupInspect } from "../lib/api";
import { longWithTimeRu } from "../lib/dates";
import { splitTitle } from "../lib/platforms";
import { bookmarkCount, fileNameOf, folderCount, RESTORE_MODES, tileNote } from "../lib/restore";
import type { ImportInspection, ImportMode } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { ChoiceCards } from "./ChoiceCards";
import { DialogFact, DialogHead, DialogPocket, SubmitMark } from "./DialogHead";
import { Icon, type IconName } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

interface ImportDialogProps {
  path: string;
  titleId: string;
  onClose: () => void;
  onImported: (applied: { folders: number; bookmarks: number }) => void;
}

const FILTERS = [{ name: "Резервная копия Booked", extensions: ["json"] }];

function RestoreEmpty({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  const parts = splitTitle(title);
  return (
    <div className="restore-empty" role="status">
      <div className="empty-folder-art" aria-hidden="true">
        <span className="empty-folder-back" />
        <span className="empty-folder-body">
          <Icon name={icon} />
        </span>
      </div>
      <p className="empty-folder-title">
        {parts.light ? <span className="empty-folder-title-light">{parts.light} </span> : null}
        {parts.bold}
      </p>
      <p className="restore-empty-hint">{hint}</p>
    </div>
  );
}

export function ImportDialog({ path: initialPath, titleId, onClose, onImported }: ImportDialogProps) {
  const [path, setPath] = useState(initialPath);
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInspection(null);
    setApplyError(null);
    setBackupPath(null);
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

  async function handleReplaceRequest() {
    if (busy) return;
    setBusy(true);
    setApplyError(null);
    try {
      setBackupPath(await backupAutoExport());
    } catch (err) {
      setApplyError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(applyMode: ImportMode) {
    if (busy || !inspection?.summary) return;
    setBusy(true);
    setApplyError(null);
    try {
      await backupImport(path, applyMode);
      onImported({ folders: inspection.summary.folders, bookmarks: inspection.summary.bookmarks });
      onClose();
    } catch (err) {
      setApplyError(userMessage(err));
      setBusy(false);
    }
  }

  function handleRestore() {
    if (mode === "merge") void handleApply("merge");
    else void handleReplaceRequest();
  }

  const summary = inspection?.ok ? inspection.summary : null;
  const currentFolders = inspection?.currentFolders ?? 0;
  const currentBookmarks = inspection?.currentBookmarks ?? 0;
  const errorNote = applyError ? (
    <ShowcaseNote icon="alert" className="restore-error">
      {applyError}
    </ShowcaseNote>
  ) : null;

  return (
    <div className="import-dialog dialog">
      <DialogHead id={titleId} title="Восстановление из резервной копии" onClose={onClose} />

      {loading && (
        <>
          <div className="dialog-body">
            <RestoreEmpty icon="hourglass" title="Читаем файл" hint={fileNameOf(path)} />
          </div>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
          </div>
        </>
      )}

      {!loading && summary && !backupPath && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRestore();
          }}
        >
          <div className="dialog-body">
            <DialogPocket className="restore-summary">
              <div className="restore-file">
                <span className="restore-file-icon" aria-hidden="true">
                  <Icon name="file" />
                </span>
                <span className="restore-file-text">
                  <span className="restore-file-name" title={inspection?.fileName ?? undefined}>
                    {inspection?.fileName ?? fileNameOf(path)}
                  </span>
                  <span className="restore-file-date">{longWithTimeRu(summary.exportedAt)}</span>
                </span>
              </div>
              <div className="restore-tiles">
                <div className="restore-tile">
                  <span className="restore-tile-label">В копии</span>
                  <span className="restore-tile-number restore-tile-number-strong">{summary.bookmarks}</span>
                  <span className="restore-tile-note">{tileNote(summary.bookmarks, summary.folders)}</span>
                </div>
                <div className="restore-tile restore-tile-now">
                  <span className="restore-tile-label">Сейчас в Booked</span>
                  <span className="restore-tile-number">{currentBookmarks}</span>
                  <span className="restore-tile-note">{tileNote(currentBookmarks, currentFolders)}</span>
                </div>
              </div>
            </DialogPocket>

            <ChoiceCards label="Как восстановить" options={RESTORE_MODES} value={mode} disabled={busy} onChange={setMode} />

            <DialogPocket className="dialog-facts">
              <DialogFact icon="trash" danger>
                При замене удалятся нынешние <b>{bookmarkCount(currentBookmarks)}</b> и <b>{folderCount(currentFolders)}</b>
              </DialogFact>
              <DialogFact icon="shield">Перед заменой Booked сам сохранит копию нынешней базы</DialogFact>
            </DialogPocket>

            {errorNote}
          </div>

          <div className="form-actions">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" aria-busy={busy} disabled={busy}>
              Восстановить
              <SubmitMark />
            </button>
          </div>
        </form>
      )}

      {!loading && summary && backupPath && (
        <>
          <div className="dialog-body">
            <DialogPocket className="dialog-facts">
              <DialogFact icon="trash" danger>
                Нынешние <b>{bookmarkCount(currentBookmarks)}</b> и <b>{folderCount(currentFolders)}</b> удалятся сейчас
              </DialogFact>
              <DialogFact icon="shield">
                Из копии встанут <b>{bookmarkCount(summary.bookmarks)}</b> и <b>{folderCount(summary.folders)}</b>
              </DialogFact>
            </DialogPocket>
            <p className="restore-saved">
              <Icon name="check" />
              <span className="restore-saved-label">Копия нынешней базы сохранена:</span>
              <span className="restore-saved-path" title={backupPath}>
                {backupPath}
              </span>
            </p>
            {errorNote}
          </div>

          <div className="form-actions">
            <button
              type="button"
              autoFocus
              onClick={() => {
                setBackupPath(null);
                setApplyError(null);
              }}
            >
              Отмена
            </button>
            <button
              type="button"
              className="danger-button"
              aria-busy={busy}
              disabled={busy}
              onClick={() => void handleApply("replace")}
            >
              Стереть и заменить
            </button>
          </div>
        </>
      )}

      {!loading && inspection && !summary && (
        <>
          <div className="dialog-body">
            <RestoreEmpty icon="search" title="Файл не подходит" hint="Booked открывает только свои резервные копии" />
          </div>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="restore-pick" onClick={handlePickAnother}>
              Выбрать другой файл
            </button>
          </div>
        </>
      )}
    </div>
  );
}
