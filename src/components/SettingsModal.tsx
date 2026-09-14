import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  autostartGet,
  autostartSet,
  autostartSupported as autostartSupportedApi,
  hotkeySet,
  settingsRead,
  settingsWrite,
  viewSetMode,
  viewState,
} from "../lib/api";
import { useReducedMotion } from "../lib/motion";
import { activeSection } from "../lib/scrollSpy";
import type { AppSettings, CloseAction, HotkeyStatus, LivenessPeriod, Theme, UpdateInfo, ViewMode } from "../lib/types";
import { DialogHead } from "./DialogHead";
import { Modal } from "./Modal";
import { SettingsAddSection } from "./SettingsAddSection";
import { SettingsDataSection } from "./SettingsDataSection";
import { SettingsGamesSection } from "./SettingsGamesSection";
import { SettingsUpdatesSection } from "./SettingsUpdatesSection";
import { SettingsViewSection } from "./SettingsViewSection";
import { SettingsWindowSection } from "./SettingsWindowSection";

export interface SettingsModalProps {
  initialSectionId?: string | null;
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  onHotkeyChange: (status: HotkeyStatus) => void;
  onImportPathPicked: (path: string) => void;
  update: UpdateInfo | null;
  updateLastCheck: number | null;
  onUpdateChecked: (update: UpdateInfo | null, at: number) => void;
}

interface SettingsSection {
  id: string;
  label: string;
}

const SECTIONS: SettingsSection[] = [
  { id: "view", label: "Вид" },
  { id: "window", label: "Окно" },
  { id: "add", label: "Добавление" },
  { id: "games", label: "Игры" },
  { id: "data", label: "Данные" },
  { id: "updates", label: "Обновления" },
];

const PIN_FALLBACK_MS = 900;

export function SettingsModal({
  initialSectionId,
  onClose,
  onThemeChange,
  onHotkeyChange,
  onImportPathPicked,
  update,
  updateLastCheck,
  onUpdateChecked,
}: SettingsModalProps) {
  const initialId = SECTIONS.some((section) => section.id === initialSectionId)
    ? (initialSectionId as string)
    : SECTIONS[0].id;
  const [activeId, setActiveId] = useState(initialId);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [rootMode, setRootMode] = useState<ViewMode>("tiles");
  const [autostartSupported, setAutostartSupported] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const railRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<string | null>(null);
  const pinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const reduced = useReducedMotion();

  useEffect(() => {
    settingsRead().then(setSettings).catch((err) => console.error(err));
    viewState(null)
      .then((v) => setRootMode(v.mode))
      .catch((err) => console.error(err));
    autostartSupportedApi()
      .then((supported) => {
        setAutostartSupported(supported);
        if (supported) {
          return autostartGet().then(setAutostartEnabled);
        }
      })
      .catch((err) => console.error(err));
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const target = sectionRefs.current[initialId];
    if (!canvas || !target || initialId === SECTIONS[0].id) return;
    pin(initialId);
    canvas.scrollTop = target.offsetTop;
  }, []);

  useEffect(() => {
    railRefs.current[SECTIONS.findIndex((s) => s.id === initialId)]?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("scrollend", releasePin);
    return () => {
      canvas.removeEventListener("scrollend", releasePin);
      if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    };
  }, []);

  function pin(id: string) {
    pinnedRef.current = id;
    if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    pinTimerRef.current = setTimeout(releasePin, PIN_FALLBACK_MS);
  }

  function releasePin() {
    pinnedRef.current = null;
  }

  function syncActive() {
    const canvas = canvasRef.current;
    if (!canvas || pinnedRef.current) return;
    const tops = SECTIONS.flatMap((section) => {
      const el = sectionRefs.current[section.id];
      return el ? [{ id: section.id, top: el.offsetTop }] : [];
    });
    const next = activeSection(tops, canvas);
    if (next) setActiveId(next);
  }

  function jumpTo(id: string) {
    setActiveId(id);
    const canvas = canvasRef.current;
    const target = sectionRefs.current[id];
    if (!canvas || !target) return;
    const top = Math.min(target.offsetTop, canvas.scrollHeight - canvas.clientHeight);
    if (Math.abs(canvas.scrollTop - top) < 1) return;
    pin(id);
    canvas.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }

  function handleRailKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowDown" ? 1 : -1) + SECTIONS.length) % SECTIONS.length;
    railRefs.current[next]?.focus();
    jumpTo(SECTIONS[next].id);
  }

  function renderSection(id: string) {
    switch (id) {
      case "view":
        return (
          <SettingsViewSection
            theme={settings?.theme ?? "system"}
            mode={rootMode}
            onThemeChange={handleThemeChange}
            onModeChange={handleModeChange}
          />
        );
      case "window":
        return (
          <SettingsWindowSection
            closeAction={settings?.closeAction ?? "ask"}
            onCloseActionChange={handleCloseActionChange}
            autostartSupported={autostartSupported}
            autostartEnabled={autostartEnabled}
            autostartBusy={autostartBusy}
            autostartError={autostartError}
            onAutostartChange={handleAutostartChange}
          />
        );
      case "add":
        return (
          <SettingsAddSection hotkey={settings?.quickAddHotkey ?? "Ctrl+Alt+B"} onHotkeyApply={handleHotkeyApply} />
        );
      case "games":
        return <SettingsGamesSection />;
      case "data":
        return (
          <SettingsDataSection
            livenessPeriod={settings?.livenessPeriod ?? "week"}
            onLivenessPeriodChange={handleLivenessPeriodChange}
            onImportPathPicked={onImportPathPicked}
          />
        );
      case "updates":
        return <SettingsUpdatesSection update={update} lastCheck={updateLastCheck} onChecked={onUpdateChecked} />;
      default:
        return null;
    }
  }

  async function handleThemeChange(theme: Theme) {
    const prev = settings?.theme ?? "system";
    setSettings((s) => (s ? { ...s, theme } : s));
    onThemeChange(theme);
    try {
      await settingsWrite("theme", theme);
    } catch (err) {
      console.error(err);
      setSettings((s) => (s ? { ...s, theme: prev } : s));
      onThemeChange(prev);
    }
  }

  async function handleModeChange(mode: ViewMode) {
    const prev = rootMode;
    setRootMode(mode);
    try {
      await viewSetMode(null, mode);
    } catch (err) {
      console.error(err);
      setRootMode(prev);
    }
  }

  async function handleCloseActionChange(closeAction: CloseAction) {
    const prev = settings?.closeAction ?? "ask";
    setSettings((s) => (s ? { ...s, closeAction } : s));
    try {
      await settingsWrite("close_action", closeAction);
    } catch (err) {
      console.error(err);
      setSettings((s) => (s ? { ...s, closeAction: prev } : s));
    }
  }

  async function handleHotkeyApply(combo: string): Promise<HotkeyStatus> {
    const status = await hotkeySet(combo);
    setSettings((s) => (s ? { ...s, quickAddHotkey: status.combo } : s));
    onHotkeyChange(status);
    return status;
  }

  async function handleLivenessPeriodChange(period: LivenessPeriod) {
    const prev = settings?.livenessPeriod ?? "week";
    setSettings((s) => (s ? { ...s, livenessPeriod: period } : s));
    try {
      await settingsWrite("liveness_period", period);
    } catch (err) {
      console.error(err);
      setSettings((s) => (s ? { ...s, livenessPeriod: prev } : s));
    }
  }

  async function handleAutostartChange(enabled: boolean) {
    const prev = autostartEnabled;
    setAutostartEnabled(enabled);
    setAutostartBusy(true);
    setAutostartError(null);
    try {
      await autostartSet(enabled);
    } catch (err) {
      console.error(err);
      setAutostartEnabled(prev);
      setAutostartError("Не получилось изменить автозапуск. Попробуйте ещё раз.");
    } finally {
      setAutostartBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} titleId="settings-title">
      <div className="settings-panel dialog">
        <DialogHead id="settings-title" title="Настройки" onClose={onClose} closeLabel="Закрыть настройки" />
        <div className="settings-body">
          <nav className="settings-rail" aria-label="Разделы настроек">
            {SECTIONS.map((section, index) => (
              <button
                key={section.id}
                type="button"
                aria-current={section.id === activeId ? "true" : undefined}
                aria-controls={`settings-section-${section.id}`}
                className={`settings-rail-item${section.id === activeId ? " active" : ""}`}
                ref={(el) => {
                  railRefs.current[index] = el;
                }}
                onClick={() => jumpTo(section.id)}
                onKeyDown={(e) => handleRailKeyDown(e, index)}
              >
                {section.label}
              </button>
            ))}
          </nav>
          <div
            className="settings-canvas"
            ref={canvasRef}
            onScroll={syncActive}
            onWheel={releasePin}
            onPointerDown={releasePin}
            onKeyDown={releasePin}
          >
            {SECTIONS.map((section) => (
              <section
                key={section.id}
                id={`settings-section-${section.id}`}
                className="settings-section"
                aria-labelledby={`settings-section-title-${section.id}`}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
              >
                <h3 id={`settings-section-title-${section.id}`} className="settings-section-title">
                  {section.label}
                </h3>
                {renderSection(section.id)}
              </section>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
