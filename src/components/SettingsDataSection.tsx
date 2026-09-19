import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";

import { backupAutoInfo, backupAutoReveal, backupExport, tagUsage } from "../lib/api";
import type { AutoBackupInfo } from "../lib/api";
import { isoDateForFilename, relativeRu } from "../lib/dates";
import { tagsSummary } from "../lib/tagEditor";
import type { LivenessPeriod } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { Icon } from "./Icon";

interface SettingsDataSectionProps {
  livenessPeriod: LivenessPeriod;
  onLivenessPeriodChange: (period: LivenessPeriod) => void;
  onImportPathPicked: (path: string) => void;
  onOpenTags: () => void;
}

const PERIODS: Array<{ value: LivenessPeriod; label: string }> = [
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "never", label: "Никогда" },
];

const JSON_FILTERS = [{ name: "Резервная копия Booked", extensions: ["json"] }];

export function SettingsDataSection({
  livenessPeriod,
  onLivenessPeriodChange,
  onImportPathPicked,
  onOpenTags,
}: SettingsDataSectionProps) {
  const activeIndex = PERIODS.findIndex((p) => p.value === livenessPeriod);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [tagsHint, setTagsHint] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoBackupInfo | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    tagUsage()
      .then((tags) => alive && setTagsHint(tagsSummary(tags)))
      .catch((err) => console.error(err));
    backupAutoInfo()
      .then((info) => alive && setAuto(info))
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

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
    const defaultPath = `booked-backup-${isoDateForFilename(new Date())}.json`;
    const picked = await save({ defaultPath, filters: JSON_FILTERS });
    if (!picked) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await backupExport(picked);
    } catch (err) {
      setExportError(userMessage(err));
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
          <span className="settings-row-hint">Папки и закладки, без игр</span>
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
            <Icon name="shield" />
            Сохранить копию
          </button>
          <button type="button" className="settings-backup-button" onClick={handleImportPick}>
            <Icon name="undo" />
            Восстановить
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Автокопия раз в неделю</span>
          {auto && (
            <span className="settings-row-hint" title={auto.dir}>
              {auto.lastAt === null ? "Ещё не сохранялась" : `Сохранена ${relativeRu(auto.lastAt, Math.floor(Date.now() / 1000))}`} ·
              вся база с играми, 5 последних копий в «Документы\Booked»
            </span>
          )}
          {autoError && <div className="settings-row-error">{autoError}</div>}
        </div>
        <button
          type="button"
          className="settings-backup-button"
          onClick={() => backupAutoReveal().catch((err) => setAutoError(userMessage(err)))}
        >
          <Icon name="folder" />
          Открыть папку
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Теги</span>
          {tagsHint && <span className="settings-row-hint">{tagsHint}</span>}
        </div>
        <button type="button" className="settings-backup-button" onClick={onOpenTags}>
          <Icon name="tag" />
          Изменить…
        </button>
      </div>
    </div>
  );
}
