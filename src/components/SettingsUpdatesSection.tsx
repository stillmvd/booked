import { checkNow, installNow, useShip } from "@stillmvd/tauri-ship";

import { checkedAgo, describeUpdateError, formatProgress } from "../lib/updates";
import { SubmitMark } from "./DialogHead";
import { Icon } from "./Icon";

export function SettingsUpdatesSection() {
  const { status } = useShip();
  const phase = status?.phase ?? "idle";
  const available = status?.available ?? null;
  const ready = phase === "ready" || phase === "installing";

  const hint =
    phase === "checking"
      ? "Проверяется…"
      : status?.lastCheck
        ? checkedAgo(status.lastCheck, Date.now()) + (available || status.error ? "" : " · это последняя версия")
        : "Ещё не проверялось";

  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Установлена версия {status?.current ?? ""}</span>
          <div className="settings-row-hint">{hint}</div>
          {status?.error && (
            <div className="settings-row-error" title={status.error}>
              {describeUpdateError(status.error)}
            </div>
          )}
        </div>
        <button
          type="button"
          className="settings-backup-button"
          aria-busy={phase === "checking"}
          disabled={phase !== "idle"}
          onClick={() => {
            checkNow().catch(() => {});
          }}
        >
          <Icon name="reset" />
          Проверить
        </button>
      </div>

      {available && (
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">Доступна версия {available.version}</span>
            <div className="settings-row-hint" aria-live="polite">
              {phase === "downloading"
                ? status?.downloaded
                  ? `Скачивается: ${formatProgress(status.downloaded, status.total)}`
                  : "Скачивается…"
                : phase === "installing"
                  ? "Ставится, приложение сейчас закроется и откроется заново"
                  : phase === "ready"
                    ? "Скачана, поставится при перезапуске"
                    : status?.error
                      ? "Не скачалась — «Проверить» попробует снова"
                      : "Скачается в фоне"}
            </div>
          </div>
          {ready && (
            <button
              type="button"
              className="btn-primary"
              aria-busy={phase === "installing"}
              disabled={phase === "installing"}
              onClick={() => {
                installNow().catch(() => {});
              }}
            >
              Перезапустить для обновления
              <SubmitMark />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
