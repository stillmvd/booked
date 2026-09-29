import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { isArchivePath, pageUrlProblem, sourceName } from "../lib/gameImport";
import { formatSize } from "../lib/gameFormat";
import { DialogHead, DialogPocket, SubmitMark } from "./DialogHead";
import { Icon } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

const IMPORT_PROGRESS_EVENT = "games:import-progress";

interface ImportProgress {
  done: number;
  total: number;
}

interface GameImportDialogProps {
  path: string;
  titleId: string;
  ready: boolean;
  error: string | null;
  waiting: boolean;
  onSubmit: (url: string | null) => void;
  onCancel: () => void;
}

export function GameImportDialog({ path, titleId, ready, error, waiting, onSubmit, onCancel }: GameImportDialogProps) {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const zip = isArchivePath(path);

  useEffect(() => {
    const off = listen<ImportProgress>(IMPORT_PROGRESS_EVENT, (e) => setProgress(e.payload));
    return () => {
      off.then((stop) => stop());
    };
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (error || waiting) return;
    const problem = pageUrlProblem(url);
    setUrlError(problem);
    if (problem) return;
    onSubmit(url.trim() === "" ? null : url.trim());
  }

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
  const verb = zip ? "Распаковывается" : "Переносится";
  const statusText = error
    ? null
    : ready
      ? zip
        ? "Распаковано в папку с играми"
        : "Перенесено в папку с играми"
      : progress && progress.total > 0
        ? `${verb}: ${formatSize(progress.done)} из ${formatSize(progress.total)}`
        : `${verb}…`;

  return (
    <form className="game-import dialog" onSubmit={submit}>
      <DialogHead id={titleId} title="Добавить игру" onClose={onCancel} closeLabel={ready ? "Закрыть" : "Отменить"} />

      <div className="dialog-body">
        <DialogPocket className="game-import-source">
          <span className="game-import-name">
            <Icon name={zip ? "file" : "folder"} />
            <span>{sourceName(path)}</span>
          </span>
          {statusText ? (
            <span className="game-import-status" aria-live="polite">
              {statusText}
            </span>
          ) : null}
          {!error ? (
            <div
              className="update-bar game-import-bar"
              role="progressbar"
              aria-label={zip ? "Распаковка архива" : "Перенос папки"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ready ? 100 : (percent ?? undefined)}
            >
              <i style={{ transform: `scaleX(${ready ? 1 : (percent ?? 0) / 100})` }} />
            </div>
          ) : null}
        </DialogPocket>

        {error ? (
          <ShowcaseNote icon="alert" className="games-note-danger">
            {error}
          </ShowcaseNote>
        ) : (
          <label className="field">
            <span className="field-label">Страница игры</span>
            <input
              type="url"
              value={url}
              placeholder="https://f95zone.to/threads/…"
              autoFocus
              disabled={waiting}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError(null);
              }}
            />
            <span className={urlError ? "field-hint form-error" : "field-hint"}>
              {urlError ?? "С F95zone или itch.io подтянутся название, обложка, версия и движок. Можно оставить пустым."}
            </span>
          </label>
        )}
      </div>

      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          {error || ready ? "Закрыть" : "Отменить"}
        </button>
        {!error ? (
          <button type="submit" disabled={waiting}>
            {waiting ? (zip ? "Добавлю после распаковки" : "Добавлю после переноса") : "Добавить"}
            <SubmitMark />
          </button>
        ) : null}
      </div>
    </form>
  );
}
