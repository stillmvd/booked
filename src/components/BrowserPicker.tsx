import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { browserList } from "../lib/api";
import type { BrowserEntry, BrowserTarget } from "../lib/types";

interface BrowserPickerProps {
  value: BrowserTarget;
  onChange: (target: BrowserTarget) => void;
}

interface Row {
  key: string;
  label: string;
  target: BrowserTarget;
}

const NONE_TARGET: BrowserTarget = { browser: null, profile: null, profileName: null };

function browserKeyOf(name: string): string {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join("-");
}

export function BrowserPicker({ value, onChange }: BrowserPickerProps) {
  const [entries, setEntries] = useState<BrowserEntry[]>([]);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    browserList().then(setEntries);
  }, []);

  const rows: Row[] = [
    { key: "", label: "Без назначения — как обычно", target: NONE_TARGET },
    ...entries.map((entry) => ({
      key: entry.key,
      label: entry.name,
      target: { browser: entry.name, profile: null, profileName: null },
    })),
  ];

  const selectedKey = value.browser ? browserKeyOf(value.browser) : "";
  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.key === selectedKey),
  );

  function selectIndex(index: number) {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    onChange(rows[clamped].target);
    rowRefs.current[clamped]?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectIndex(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectIndex(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      selectIndex(rows.length - 1);
    }
  }

  return (
    <div className="field browser-field">
      <span className="field-label">Браузер</span>
      <div className="browser-list" role="radiogroup" aria-label="Браузер и профиль">
        {rows.map((row, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              key={row.key}
              tabIndex={selected ? 0 : -1}
              className="browser-option"
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              onClick={() => onChange(row.target)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              <span className="browser-option-icon-slot" aria-hidden="true" />
              <span className="browser-option-label">{row.label}</span>
              {selected ? (
                <span className="browser-option-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {entries.length === 0 ? (
        <p className="browser-empty">Другие браузеры не найдены на этом компьютере</p>
      ) : null}
    </div>
  );
}
