import type { CloseAction } from "../lib/types";
import { SettingsToggle } from "./SettingsToggle";

interface SettingsWindowSectionProps {
  closeAction: CloseAction;
  onCloseActionChange: (closeAction: CloseAction) => void;
}

export function SettingsWindowSection({ closeAction, onCloseActionChange }: SettingsWindowSectionProps) {
  const trayEnabled = closeAction === "tray";

  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Закрывать в трей</span>
          <div className="settings-row-hint">
            {trayEnabled
              ? "Крестик прячет окно, приложение остаётся работать"
              : "Крестик спрашивает при первом закрытии"}
          </div>
        </div>
        <SettingsToggle
          checked={trayEnabled}
          onChange={(checked) => onCloseActionChange(checked ? "tray" : "ask")}
          label="Закрывать в трей"
        />
      </div>
    </div>
  );
}
