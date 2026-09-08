import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { gamesLibrary, gamesRootSet } from "../lib/api";
import { userMessage } from "../lib/userMessage";

export function SettingsGamesSection() {
  const [root, setRoot] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    let alive = true;
    gamesLibrary()
      .then((library) => {
        if (!alive) return;
        setRoot(library.root);
        setAvailable(library.rootAvailable);
        setCount(library.games.length);
      })
      .catch((err) => alive && setError(userMessage(err)));
    return () => {
      alive = false;
      mounted.current = false;
    };
  }, []);

  async function pickFolder() {
    const picked = await open({ directory: true, multiple: false });
    if (!picked || Array.isArray(picked)) return;
    setBusy(true);
    setError(null);
    try {
      const library = await gamesRootSet(picked);
      if (!mounted.current) return;
      setRoot(library.root);
      setAvailable(library.rootAvailable);
      setCount(library.games.length);
    } catch (err) {
      if (mounted.current) setError(userMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Папка с играми</span>
          <span className="settings-row-hint">
            {root
              ? available
                ? `${root} · игр в разделе: ${count}`
                : `${root} — папка сейчас недоступна`
              : "Пока не выбрана. Укажите папку, куда вы складываете игры."}
          </span>
          {error && <div className="settings-row-error">{error}</div>}
        </div>
        <button
          type="button"
          className="settings-backup-button"
          aria-busy={busy}
          disabled={busy}
          onClick={pickFolder}
        >
          {root ? "Выбрать другую" : "Выбрать папку"}
        </button>
      </div>
    </div>
  );
}
