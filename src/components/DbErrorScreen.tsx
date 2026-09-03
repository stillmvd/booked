import { useState } from "react";

import { dbReveal, dbStartFresh } from "../lib/api";
import { userMessage } from "../lib/userMessage";

interface DbErrorScreenProps {
  path: string;
  message: string;
  onRecovered: () => void;
}

export function DbErrorScreen({ path, message, onRecovered }: DbErrorScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="db-error-panel">
        <h1 className="db-error-title">База данных не открылась</h1>
        <p className="db-error-text">{message}</p>
        <code className="db-error-path">{path}</code>

        <div className="db-error-actions">
          <button type="button" onClick={handleReveal}>
            Открыть папку
          </button>
          <button type="button" className="danger-button" onClick={handleStartFresh} disabled={busy}>
            Начать заново
          </button>
        </div>
        <p className="db-error-hint">
          Старый файл базы будет переименован и останется рядом с новым — он не удаляется.
        </p>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </div>
  );
}
