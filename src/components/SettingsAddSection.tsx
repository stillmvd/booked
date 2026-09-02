import type { HotkeyStatus } from "../lib/types";
import { HotkeyField } from "./HotkeyField";

interface SettingsAddSectionProps {
  hotkey: string;
  onHotkeyApply: (combo: string) => Promise<HotkeyStatus>;
}

export function SettingsAddSection({ hotkey, onHotkeyApply }: SettingsAddSectionProps) {
  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Хоткей быстрого добавления</span>
        </div>
        <HotkeyField combo={hotkey} onApply={onHotkeyApply} />
      </div>
    </div>
  );
}
