import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";

import { updateCheck, updateDownload, updateInstall } from "../lib/api";
import { relativeRu } from "../lib/dates";
import type { UpdateInfo, UpdateProgress } from "../lib/types";
import { describeUpdateError, formatProgress } from "../lib/updates";

interface SettingsUpdatesSectionProps {
  update: UpdateInfo | null;
  lastCheck: number | null;
  onChecked: (update: UpdateInfo | null, at: number) => void;
}

type Phase = "idle" | "checking" | "downloading" | "installing";

export function SettingsUpdatesSection({ update, lastCheck, onChecked }: SettingsUpdatesSectionProps) {
  const [appVersion, setAppVersion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [upToDate, setUpToDate] = useState(false);

  useEffect(() => {
    getVersion().then(setAppVersion).catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (phase !== "downloading") return;
    let unlisten: (() => void) | undefined;
    listen<UpdateProgress>("update-progress", (e) => setProgress(e.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [phase]);

  async function handleCheck() {
    setPhase("checking");
    setCheckError(null);
    setUpToDate(false);
    try {
      const found = await updateCheck();
      onChecked(found, Date.now());
      setUpToDate(found === null);
    } catch (err) {
      setCheckError(describeUpdateError(err));
    } finally {
      setPhase("idle");
    }
  }

  async function handleUpdate() {
    setUpdateError(null);
    setProgress(null);
    setPhase("downloading");
    try {
      await updateDownload();
      setPhase("installing");
      await updateInstall();
    } catch (err) {
      setUpdateError(describeUpdateError(err));
      setPhase("idle");
    }
  }

  const checkedHint = checkError
    ? null
    : upToDate
      ? "Это последняя версия"
      : lastCheck === null
        ? "Ещё не проверялось"
        : `Проверено ${relativeRu(lastCheck, Date.now())}`;

  const busy = phase === "downloading" || phase === "installing";
  const percent = progress && progress.total ? Math.round((progress.downloaded / progress.total) * 100) : null;

  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Установлена версия {appVersion}</span>
          {checkedHint && <div className="settings-row-hint">{checkedHint}</div>}
          {checkError && <div className="settings-row-error">{checkError}</div>}
        </div>
        <button
          type="button"
          className="settings-backup-button"
          aria-busy={phase === "checking"}
          disabled={phase !== "idle"}
          onClick={handleCheck}
        >
          {phase === "checking" ? "Проверяется…" : "Проверить сейчас"}
        </button>
      </div>

      {update && (
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">Доступна версия {update.version}</span>
            {phase === "downloading" && (
              <>
                <div className="settings-row-hint" aria-live="polite">
                  {progress ? `Скачивается: ${formatProgress(progress.downloaded, progress.total)}` : "Скачивается…"}
                </div>
                <div
                  className="update-bar"
                  role="progressbar"
                  aria-label="Скачивание обновления"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? undefined}
                >
                  <i style={{ width: `${percent ?? 0}%` }} />
                </div>
              </>
            )}
            {phase === "installing" && (
              <div className="settings-row-hint" aria-live="polite">
                Ставится, приложение сейчас закроется и откроется заново
              </div>
            )}
            {phase !== "downloading" && phase !== "installing" && (
              <div className="settings-row-hint">Скачать и поставить, приложение перезапустится</div>
            )}
            {updateError && <div className="settings-row-error">{updateError}</div>}
          </div>
          <button type="button" className="btn-primary" aria-busy={busy} disabled={busy} onClick={handleUpdate}>
            Обновить
          </button>
        </div>
      )}
    </div>
  );
}
