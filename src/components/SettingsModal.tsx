import { useEffect, useRef, useState } from "react";
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
import type { AppSettings, CloseAction, HotkeyStatus, LivenessPeriod, Theme, ViewMode } from "../lib/types";
import { Modal } from "./Modal";
import { SettingsAddSection } from "./SettingsAddSection";
import { SettingsDataSection } from "./SettingsDataSection";
import { SettingsViewSection } from "./SettingsViewSection";
import { SettingsWindowSection } from "./SettingsWindowSection";

export interface SettingsModalProps {
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  onHotkeyChange: (status: HotkeyStatus) => void;
  onImportPathPicked: (path: string) => void;
}

interface SettingsSection {
  id: string;
  label: string;
}

const SECTIONS: SettingsSection[] = [
  { id: "view", label: "Вид" },
  { id: "window", label: "Окно" },
  { id: "add", label: "Добавление" },
  { id: "data", label: "Данные" },
];

export function SettingsModal({ onClose, onThemeChange, onHotkeyChange, onImportPathPicked }: SettingsModalProps) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [rootMode, setRootMode] = useState<ViewMode>("tiles");
  const [autostartSupported, setAutostartSupported] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const railRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

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

  useEffect(() => {
    railRefs.current[0]?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  const activeIndex = SECTIONS.findIndex((s) => s.id === activeId);

  function focusIndex(index: number) {
    const clamped = (index + SECTIONS.length) % SECTIONS.length;
    setActiveId(SECTIONS[clamped].id);
    railRefs.current[clamped]?.focus();
  }

  function handleRailKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusIndex(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(activeIndex - 1);
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
      <div className="settings-panel">
        <div className="settings-head">
          <span className="settings-head-title" id="settings-title">Настройки</span>
          <button type="button" className="settings-close" aria-label="Закрыть настройки" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="1">
              <path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5" />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-rail" role="tablist" aria-orientation="vertical" aria-label="Разделы настроек">
            {SECTIONS.map((section, index) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                id={`settings-tab-${section.id}`}
                aria-selected={section.id === activeId}
                aria-controls={`settings-panel-${section.id}`}
                tabIndex={section.id === activeId ? 0 : -1}
                className={`settings-rail-item${section.id === activeId ? " active" : ""}`}
                ref={(el) => {
                  railRefs.current[index] = el;
                }}
                onClick={() => setActiveId(section.id)}
                onKeyDown={handleRailKeyDown}
              >
                {section.label}
              </button>
            ))}
          </div>
          <div
            className="settings-pane"
            role="tabpanel"
            id={`settings-panel-${activeId}`}
            aria-labelledby={`settings-tab-${activeId}`}
          >
            {activeId === "view" && (
              <SettingsViewSection
                theme={settings?.theme ?? "system"}
                mode={rootMode}
                onThemeChange={handleThemeChange}
                onModeChange={handleModeChange}
              />
            )}
            {activeId === "window" && (
              <SettingsWindowSection
                closeAction={settings?.closeAction ?? "ask"}
                onCloseActionChange={handleCloseActionChange}
                autostartSupported={autostartSupported}
                autostartEnabled={autostartEnabled}
                autostartBusy={autostartBusy}
                autostartError={autostartError}
                onAutostartChange={handleAutostartChange}
              />
            )}
            {activeId === "add" && (
              <SettingsAddSection
                hotkey={settings?.quickAddHotkey ?? "Ctrl+Alt+B"}
                onHotkeyApply={handleHotkeyApply}
              />
            )}
            {activeId === "data" && (
              <SettingsDataSection
                livenessPeriod={settings?.livenessPeriod ?? "week"}
                onLivenessPeriodChange={handleLivenessPeriodChange}
                onImportPathPicked={onImportPathPicked}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
