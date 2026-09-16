import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

import { maximizeLabel, settingsHint, settingsLabel, updateMark } from "../lib/titlebar";

interface TitlebarProps {
  onOpenSettings: () => void;
  updateVersion?: string | null;
}

export function Titlebar({ onOpenSettings, updateVersion = null }: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win.isMaximized().then(setMaximized);
    win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="titlebar">
      <span className="titlebar-brand" data-tauri-drag-region>
        <svg className="titlebar-mark" viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
          <path d="M44 24h168v212l-84-50-84 50z" fill="currentColor" />
        </svg>
        <span className="titlebar-title">Booked</span>
      </span>

      <div className="titlebar-drag" data-tauri-drag-region />

      <button
        type="button"
        className="titlebar-settings"
        aria-label={settingsLabel(updateVersion)}
        title={settingsHint(updateVersion)}
        data-update={updateMark(updateVersion)}
        onClick={onOpenSettings}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <div className="titlebar-window-controls">
        <button
          type="button"
          className="titlebar-button"
          aria-label="Свернуть"
          onClick={() => {
            void getCurrentWindow().minimize();
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinecap="round">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-button"
          aria-label={maximizeLabel(maximized)}
          onClick={() => {
            void getCurrentWindow().toggleMaximize();
          }}
        >
          {maximized ? (
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinecap="round">
              <rect x="3.5" y="5.5" width="7" height="7" rx="1.5" />
              <path d="M5.5 5.5v-2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinecap="round">
              <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-button-close"
          aria-label="Закрыть"
          onClick={() => {
            void invoke("hide_to_tray");
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1.2" strokeLinecap="round">
            <path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
