import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function Titlebar() {
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
      <svg
        className="titlebar-mark"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        stroke="currentColor"
        fill="none"
        strokeWidth="1"
        aria-hidden="true"
      >
        <path d="M6 4.25v8l2-1.5 2 1.5V4.25a.5.5 0 0 0-.5-.5H6.5a.5.5 0 0 0-.5.5z" />
      </svg>

      <div
        className="titlebar-drag"
        data-tauri-drag-region
        onDoubleClick={() => {
          void getCurrentWindow().toggleMaximize();
        }}
      />

      <div className="titlebar-window-controls">
        <button
          type="button"
          className="titlebar-button"
          aria-label="Свернуть"
          onClick={() => {
            void getCurrentWindow().minimize();
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar-button"
          aria-label={maximized ? "Восстановить окно" : "Развернуть окно"}
          onClick={() => {
            void getCurrentWindow().toggleMaximize();
          }}
        >
          {maximized ? (
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1">
              <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
              <path d="M5.5 5.5v-2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1">
              <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-button-close"
          aria-label="Закрыть"
          onClick={() => {
            void getCurrentWindow().hide();
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1">
            <path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
