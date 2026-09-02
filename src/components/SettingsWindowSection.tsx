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

export function SettingsWindowSection({
  closeAction,
  onCloseActionChange,
  autostartSupported,
  autostartEnabled,
  autostartBusy,
  autostartError,
  onAutostartChange,
}: SettingsWindowSectionProps) {
  const trayEnabled = closeAction === "tray";
  const hint = trayEnabled
    ? "Крестик прячет окно, приложение остаётся работать"
    : closeAction === "quit"
      ? "Крестик завершает приложение"
      : "Крестик спрашивает при первом закрытии";

  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Закрывать в трей</span>
          <div className="settings-row-hint">
            {hint}
          </div>
        </div>
        <SettingsToggle
          checked={trayEnabled}
          onChange={(checked) => onCloseActionChange(checked ? "tray" : "quit")}
          label="Закрывать в трей"
        />
      </div>
      {autostartSupported && (
        <div className="settings-row">
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
