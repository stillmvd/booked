import { useState } from "react";

import { dbReveal, dbStartFresh } from "../lib/api";
import { splitExePath } from "../lib/gameFormat";
import { splitTitle } from "../lib/platforms";
import { userMessage } from "../lib/userMessage";
import { DialogPocket } from "./DialogHead";
import { Icon } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

interface DbErrorScreenProps {
  path: string;
  message: string;
  onRecovered: () => void;
}

const TITLE = splitTitle("База данных не открылась");

export function DbErrorScreen({ path, message, onRecovered }: DbErrorScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = splitExePath(path);

  async function handleReveal() {
    try {
      await dbReveal();
    } catch (err) {
      setError(userMessage(err));
    }
  }

  async function handleStartFresh() {
    setBusy(true);
    setError(null);
    try {
      await dbStartFresh();
      onRecovered();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="db-error-screen">
      <section className="db-error-panel" aria-labelledby="db-error-title">
        <div className="db-error-head">
          <div className="empty-folder-art" aria-hidden="true">
            <span className="empty-folder-back" />
            <span className="empty-folder-body">
              <Icon name="alert" />
            </span>
          </div>
          <h1 id="db-error-title" className="db-error-title">
            {TITLE.light ? <span className="db-error-title-light">{TITLE.light} </span> : null}
            {TITLE.bold}
          </h1>
        </div>

        <DialogPocket className="db-error-info">
          {message ? <p className="db-error-text">{message}</p> : null}
          {path ? (
            <div className="restore-file db-error-file" title={path}>
              <span className="restore-file-icon" aria-hidden="true">
                <Icon name="file" />
              </span>
              <span className="restore-file-text">
                <span className="restore-file-name">{file.name}</span>
                {file.folder ? (
                  <span className="db-error-dir">
                    <span>{file.folder}</span>
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
          <p className="db-error-hint">Старый файл базы будет переименован и останется рядом с новым — он не удаляется.</p>
        </DialogPocket>

        {error ? <ShowcaseNote icon="alert">{error}</ShowcaseNote> : null}

        <div className="tray-actions db-error-actions">
          <button type="button" className="tray-action" onClick={handleReveal}>
            <span className="tray-action-top">
              <span className="tray-action-icon" aria-hidden="true">
                <Icon name="folder" />
              </span>
            </span>
            <span className="tray-action-text">
              <span className="tray-action-title">Открыть папку</span>
              <span className="tray-action-desc">Файл {file.name || "базы"} в Проводнике</span>
            </span>
          </button>
          <button type="button" className="tray-action db-error-fresh" onClick={handleStartFresh} aria-busy={busy} disabled={busy}>
            <span className="tray-action-top">
              <span className="tray-action-icon" aria-hidden="true">
                <Icon name="reset" />
              </span>
            </span>
            <span className="tray-action-text">
              <span className="tray-action-title">Начать заново</span>
              <span className="tray-action-desc">Booked откроется с пустой базой</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
