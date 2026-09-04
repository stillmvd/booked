import type { CloseAction } from "../lib/types";
import { SettingsToggle } from "./SettingsToggle";

interface SettingsWindowSectionProps {
  closeAction: CloseAction;
  onCloseActionChange: (closeAction: CloseAction) => void;
  autostartSupported: boolean;
  autostartEnabled: boolean;
  autostartBusy: boolean;
  autostartError: string | null;
  onAutostartChange: (enabled: boolean) => void;
}

const CLOSE_ACTIONS: Array<{ value: CloseAction; label: string; hint: string }> = [
  { value: "ask", label: "Спрашивать", hint: "Крестик спрашивает, свернуть окно или выйти" },
  { value: "tray", label: "В трей", hint: "Крестик прячет окно, приложение остаётся работать" },
  { value: "quit", label: "Выходить", hint: "Крестик завершает приложение" },
];

export function SettingsWindowSection({
  closeAction,
  onCloseActionChange,
  autostartSupported,
  autostartEnabled,
  autostartBusy,
  autostartError,
  onAutostartChange,
}: SettingsWindowSectionProps) {
  const hint = (CLOSE_ACTIONS.find((a) => a.value === closeAction) ?? CLOSE_ACTIONS[0]).hint;

  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Крестик окна</span>
          <div className="settings-row-hint">{hint}</div>
        </div>
        <div className="mode-switch mode-switch-text" role="group" aria-label="Крестик окна">
          {CLOSE_ACTIONS.map((action) => (
            <button
              key={action.value}
              type="button"
              aria-pressed={action.value === closeAction}
              onClick={() => onCloseActionChange(action.value)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
      {autostartSupported && (
        <div className="settings-row settings-row-toggle">
          <div className="settings-row-text">
            <span className="settings-row-label">Запускать вместе с Windows</span>
            <div className="settings-row-hint">Сразу свёрнутым в трей, без окна на экране</div>
            {autostartError && <div className="settings-row-error">{autostartError}</div>}
          </div>
          <SettingsToggle
            checked={autostartEnabled}
            onChange={onAutostartChange}
            label="Запускать вместе с Windows"
            disabled={autostartBusy}
          />
        </div>
      )}
    </div>
  );
}
