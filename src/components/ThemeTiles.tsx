import { useRef } from "react";
import type { KeyboardEvent } from "react";

import type { Theme } from "../lib/types";

interface ThemeTilesProps {
  value: Theme;
  onChange: (value: Theme) => void;
}

interface TileDef {
  value: Theme;
  label: string;
}

const TILES: TileDef[] = [
  { value: "system", label: "Системная" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

export function ThemeTiles({ value, onChange }: ThemeTilesProps) {
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectIndex(index: number) {
    const clamped = (index + TILES.length) % TILES.length;
    onChange(TILES[clamped].value);
    tileRefs.current[clamped]?.focus();
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
    <div className="theme-tiles" role="radiogroup" aria-label="Тема">
      {TILES.map((tile, index) => {
        const selected = tile.value === value;
        return (
          <button
            key={tile.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-pressed={selected}
            className={`theme-tile${selected ? " selected" : ""}`}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              tileRefs.current[index] = el;
            }}
            onClick={() => onChange(tile.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            <span className={`theme-tile-preview theme-tile-preview-${tile.value}`} aria-hidden="true" />
            <span className="theme-tile-label">{tile.label}</span>
          </button>
        );
      })}
    </div>
  );
}
