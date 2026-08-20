import type { ViewMode } from "../lib/types";

interface ModeSwitchProps {
  mode: ViewMode;
  overridesExist: boolean;
  onChangeMode: (mode: ViewMode) => void;
  onReset: () => void;
}

const MODES: Array<{ value: ViewMode; label: string }> = [
  { value: "tiles", label: "Плитка" },
  { value: "list", label: "Список" },
  { value: "compact", label: "Компактный" },
];

export function ModeSwitch({ mode, overridesExist, onChangeMode, onReset }: ModeSwitchProps) {
  return (
    <div className="mode-switch-row">
      <div className="mode-switch" role="group" aria-label="Режим отображения">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            onClick={() => onChangeMode(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {overridesExist && (
        <button type="button" className="mode-reset" onClick={onReset}>
          Сбросить во всех папках
        </button>
      )}
    </div>
  );
}
