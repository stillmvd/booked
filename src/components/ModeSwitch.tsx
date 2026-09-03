import type { ViewMode } from "../lib/types";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

interface ModeSwitchProps {
  mode: ViewMode;
  overridesExist: boolean;
  onChangeMode: (mode: ViewMode) => void;
  onReset: () => void;
}

const MODES: Array<{ value: ViewMode; label: string; icon: IconName }> = [
  { value: "tiles", label: "Плитка", icon: "view-tiles" },
  { value: "list", label: "Список", icon: "view-list" },
  { value: "compact", label: "Компактный", icon: "view-compact" },
];

export function ModeSwitch({ mode, overridesExist, onChangeMode, onReset }: ModeSwitchProps) {
  return (
    <>
      <div className="mode-switch" role="group" aria-label="Режим отображения">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            aria-label={m.label}
            title={m.label}
            onClick={() => onChangeMode(m.value)}
          >
            <Icon name={m.icon} />
          </button>
        ))}
      </div>
      {overridesExist && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Сбросить вид во всех папках"
          title="Сбросить вид во всех папках"
          onClick={onReset}
        >
          <Icon name="reset" />
        </button>
      )}
    </>
  );
}
