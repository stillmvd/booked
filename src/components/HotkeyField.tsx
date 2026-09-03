import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { comboFromKeyEvent, isModifierKey } from "../lib/hotkey";
import type { HotkeyStatus } from "../lib/types";

interface HotkeyFieldProps {
  combo: string;
  onApply: (combo: string) => Promise<HotkeyStatus>;
}

type Phase = "rest" | "recording" | "taken";

export function HotkeyField({ combo, onApply }: HotkeyFieldProps) {
  const [phase, setPhase] = useState<Phase>("rest");
  const [rejected, setRejected] = useState<string | null>(null);

  function startRecording() {
    setRejected(null);
    setPhase("recording");
  }

  function stopRecording() {
    setPhase("rest");
    setRejected(null);
  }

  async function tryApply(candidate: string) {
    try {
      await onApply(candidate);
      setPhase("rest");
      setRejected(null);
    } catch {
      setRejected(candidate);
      setPhase("taken");
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (phase === "recording") {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setPhase("rest");
        return;
      }
      if (isModifierKey(e.nativeEvent.code)) return;
      const candidate = comboFromKeyEvent(e.nativeEvent);
      if (!candidate) return;
      void tryApply(candidate);
      return;
    }
    if (phase === "taken" && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopRecording();
    }
  }

  const label = phase === "recording" ? "Нажмите комбинацию…" : phase === "taken" ? (rejected ?? combo) : combo;

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">Хоткей быстрого добавления</span>
        <div className="settings-row-hint hotkey-status-hint">Работает: {combo}</div>
        {phase === "taken" && (
          <div className="settings-row-error">Эту комбинацию занимает другая программа. Выберите другую.</div>
        )}
      </div>
      <div className="hotkey-field-row">
        <button
          type="button"
          className={`hotkey-field${phase === "recording" ? " hotkey-field-recording" : ""}${phase === "taken" ? " hotkey-field-taken" : ""}`}
          onClick={() => {
            if (phase !== "recording") startRecording();
          }}
          onBlur={() => {
            if (phase !== "rest") stopRecording();
          }}
          onKeyDown={handleKeyDown}
        >
          {label}
        </button>
        {phase === "taken" && <span className="hotkey-taken-tag">занято</span>}
      </div>
    </div>
  );
}
