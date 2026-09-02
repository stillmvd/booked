import type { Theme, ViewMode } from "../lib/types";
import { ModeSwitch } from "./ModeSwitch";
import { ThemeTiles } from "./ThemeTiles";

interface SettingsViewSectionProps {
  theme: Theme;
  mode: ViewMode;
  onThemeChange: (theme: Theme) => void;
  onModeChange: (mode: ViewMode) => void;
}

export function SettingsViewSection({ theme, mode, onThemeChange, onModeChange }: SettingsViewSectionProps) {
  return (
    <div className="settings-pane-section">
      <div className="settings-row">
        <span className="settings-row-label">Тема</span>
        <ThemeTiles value={theme} onChange={onThemeChange} />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">Вид по умолчанию</span>
        <ModeSwitch mode={mode} overridesExist={false} onChangeMode={onModeChange} onReset={() => {}} />
      </div>
    </div>
  );
}
