import { useRef } from "react";
import type { KeyboardEvent } from "react";

import type { Theme } from "../lib/types";

interface ThemeSwitchProps {
  value: Theme;
  onChange: (value: Theme) => void;
}

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: "system", label: "Системная" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

export function ThemeSwitch({ value, onChange }: ThemeSwitchProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectIndex(index: number) {
    const clamped = (index + THEMES.length) % THEMES.length;
    onChange(THEMES[clamped].value);
    buttonRefs.current[clamped]?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectIndex(index + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectIndex(index - 1);
    }
  }

  return (
    <div className="mode-switch mode-switch-text" role="radiogroup" aria-label="Тема">
      {THEMES.map((theme, index) => {
        const selected = theme.value === value;
        return (
          <button
            key={theme.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-pressed={selected}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            onClick={() => onChange(theme.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {theme.label}
          </button>
        );
      })}
    </div>
  );
}
