import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";

import { backupExport } from "../lib/api";
import { isoDateForFilename } from "../lib/dates";
import type { LivenessPeriod } from "../lib/types";

interface SettingsDataSectionProps {
  livenessPeriod: LivenessPeriod;
  onLivenessPeriodChange: (period: LivenessPeriod) => void;
  onImportPathPicked: (path: string) => void;
}

const PERIODS: Array<{ value: LivenessPeriod; label: string }> = [
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "never", label: "Никогда" },
];

const JSON_FILTERS = [{ name: "Выгрузка Trove", extensions: ["json"] }];

export function SettingsDataSection({
  livenessPeriod,
  onLivenessPeriodChange,
  onImportPathPicked,
}: SettingsDataSectionProps) {
  const activeIndex = PERIODS.findIndex((p) => p.value === livenessPeriod);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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

  async function handleExport() {
    const defaultPath = `trove-export-${isoDateForFilename(new Date())}.json`;
    const picked = await save({ defaultPath, filters: JSON_FILTERS });
    if (!picked) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await backupExport(picked);
    } catch (err) {
      setExportError(String(err));
    } finally {
      setExportBusy(false);
    }
  }

  async function handleImportPick() {
    const picked = await open({ multiple: false, filters: JSON_FILTERS });
    if (!picked || Array.isArray(picked)) return;
    onImportPathPicked(picked);
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

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Резервная копия</span>
          {exportError && <div className="settings-row-error">{exportError}</div>}
        </div>
        <div className="settings-button-group">
          <button
            type="button"
            className="settings-backup-button"
            aria-busy={exportBusy}
            disabled={exportBusy}
            onClick={handleExport}
          >
            Экспорт в JSON
          </button>
          <button type="button" className="settings-backup-button" onClick={handleImportPick}>
            Импорт из JSON
          </button>
        </div>
      </div>
    </div>
  );
}
