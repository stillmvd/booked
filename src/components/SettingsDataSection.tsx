import { useRef } from "react";
import type { KeyboardEvent } from "react";

import type { LivenessPeriod } from "../lib/types";

interface SettingsDataSectionProps {
  livenessPeriod: LivenessPeriod;
  onLivenessPeriodChange: (period: LivenessPeriod) => void;
}

const PERIODS: Array<{ value: LivenessPeriod; label: string }> = [
  { value: "day", label: "Раз в день" },
  { value: "week", label: "Раз в неделю" },
  { value: "month", label: "Раз в месяц" },
  { value: "never", label: "Никогда" },
];

export function SettingsDataSection({ livenessPeriod, onLivenessPeriodChange }: SettingsDataSectionProps) {
  const activeIndex = PERIODS.findIndex((p) => p.value === livenessPeriod);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusIndex(index: number) {
    const clamped = (index + PERIODS.length) % PERIODS.length;
    onLivenessPeriodChange(PERIODS[clamped].value);
    btnRefs.current[clamped]?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusIndex(activeIndex + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusIndex(activeIndex - 1);
    }
  }

  return (
    <div className="settings-pane-section">
      <div className="settings-group-label">Проверка живости</div>
      <div className="settings-row">
        <span className="settings-row-label">Проверка живости ссылок</span>
        <div className="liveness-period" role="group" aria-label="Проверка живости ссылок">
          {PERIODS.map((p, index) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={p.value === livenessPeriod}
              tabIndex={p.value === livenessPeriod ? 0 : -1}
              ref={(el) => {
                btnRefs.current[index] = el;
              }}
              onClick={() => onLivenessPeriodChange(p.value)}
              onKeyDown={handleKeyDown}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
