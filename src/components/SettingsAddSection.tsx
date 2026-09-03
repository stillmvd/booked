import type { HotkeyStatus } from "../lib/types";
import { HotkeyField } from "./HotkeyField";

interface SettingsAddSectionProps {
  hotkey: string;
  onHotkeyApply: (combo: string) => Promise<HotkeyStatus>;
}

export function SettingsAddSection({ hotkey, onHotkeyApply }: SettingsAddSectionProps) {
  return (
    <div className="settings-pane-section">
      <HotkeyField combo={hotkey} onApply={onHotkeyApply} />
    </div>
  );
}
