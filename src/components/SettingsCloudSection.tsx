import { useEffect, useId, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { cloudSet, cloudStatus } from "../lib/api";
import { CLOUD_STATUS_EVENT, cloudStateText, maskedKey } from "../lib/cloud";
import type { CloudStatus } from "../lib/types";
import { userMessage } from "../lib/userMessage";

export function SettingsCloudSection() {
  const baseId = useId();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    cloudStatus()
      .then((next) => {
        if (!mounted.current) return;
        setStatus(next);
        setUrl(next.url);
      })
      .catch((err) => mounted.current && setError(userMessage(err)));
    const unlisten = listen<CloudStatus>(CLOUD_STATUS_EVENT, (event) => {
      if (mounted.current) setStatus(event.payload);
    });
    return () => {
      mounted.current = false;
      unlisten.then((stop) => stop());
    };
  }, []);

  async function save(nextKey: string | null) {
    setBusy(true);
    setError(null);
    try {
      const next = await cloudSet(url, nextKey);
      if (!mounted.current) return;
      setStatus(next);
      setUrl(next.url);
      setKey("");
      setEditingKey(false);
    } catch (err) {
      if (mounted.current) setError(userMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const hasKey = Boolean(status?.keyTail);
  const showKeyInput = !hasKey || editingKey;

  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Облако игр</span>
          <span className="settings-row-hint">
            Статусы, звёзды и версии игр с F95zone — для расширения Sorter 95. Закладки, теги и настройки
            остаются только на этом компьютере.
          </span>
          {status && (
            <div className="settings-row-hint" aria-live="polite">
              {cloudStateText(status)}
            </div>
          )}
          {error && <div className="settings-row-error">{error}</div>}
        </div>

        <label className="game-panel-label" htmlFor={`${baseId}-url`}>
          Адрес облака
        </label>
        <div className="game-panel-field">
          <input
            id={`${baseId}-url`}
            type="url"
            value={url}
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              if (status && url.trim() !== status.url) save(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save(null);
              }
            }}
          />
        </div>

        <label className="game-panel-label" htmlFor={`${baseId}-key`}>
          Ключ
        </label>
        {showKeyInput ? (
          <div className="settings-cloud-line">
            <div className="game-panel-field">
              <input
                id={`${baseId}-key`}
                type="password"
                value={key}
                autoComplete="off"
                spellCheck={false}
                placeholder="Ключ облака"
                disabled={busy}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && key.trim()) {
                    e.preventDefault();
                    save(key);
                  }
                  if (e.key === "Escape" && editingKey) {
                    e.stopPropagation();
                    setKey("");
                    setEditingKey(false);
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="settings-backup-button"
              aria-busy={busy}
              disabled={busy || !key.trim()}
              onClick={() => save(key)}
            >
              Сохранить
            </button>
          </div>
        ) : (
          <div className="settings-cloud-line">
            <span id={`${baseId}-key`} className="settings-row-label">
              {maskedKey(status?.keyTail ?? null)}
            </span>
            <div className="settings-button-group">
              <button
                type="button"
                className="settings-backup-button"
                disabled={busy}
                onClick={() => setEditingKey(true)}
              >
                Сменить
              </button>
              <button
                type="button"
                className="settings-backup-button"
                aria-busy={busy}
                disabled={busy}
                onClick={() => save("")}
              >
                Отключить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
