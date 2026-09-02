import { getCurrentWindow } from "@tauri-apps/api/window";

export function Titlebar() {
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

      <div className="titlebar-drag" data-tauri-drag-region />

      <div className="titlebar-window-controls">
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
