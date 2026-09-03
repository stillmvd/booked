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

function PreviewWindow({ scheme, split = false }: { scheme: "light" | "dark"; split?: boolean }) {
  return (
    <span
      className={`theme-preview-window theme-preview-window-${scheme}${split ? " theme-preview-window-split" : ""}`}
    >
      <span className="theme-preview-bar" />
      <span className="theme-preview-card theme-preview-card-first" />
      <span className="theme-preview-card theme-preview-card-second" />
      <span className="theme-preview-dot" />
    </span>
  );
}

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
            <span className="theme-tile-preview" aria-hidden="true">
              <PreviewWindow scheme={tile.value === "light" ? "light" : "dark"} />
              {tile.value === "system" && <PreviewWindow scheme="light" split />}
            </span>
            <span className="theme-tile-label">{tile.label}</span>
          </button>
        );
      })}
    </div>
  );
}
