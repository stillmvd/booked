import { useEffect, useRef, useState } from "react";

import { ToastUndo } from "./ToastParts";

interface GameMergeToastProps {
  text: string;
  delayMs: number;
  startedAt: number;
  onHold: (held: boolean) => void;
  onUndo: () => void;
}

export function GameMergeToast({ text, delayMs, startedAt, onHold, onUndo }: GameMergeToastProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;
  const heldRef = useRef(false);

  useEffect(() => {
    if (heldRef.current === held) return;
    heldRef.current = held;
    onHoldRef.current(held);
  }, [held]);

  useEffect(
    () => () => {
      if (heldRef.current) onHoldRef.current(false);
    },
    [],
  );

  return (
    <div
      className={"toast game-merge-toast" + (held ? " held" : "")}
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="toast-timer-track" aria-hidden="true">
        <span
          key={startedAt}
          className="toast-timer"
          style={{ animationDuration: `${delayMs}ms`, animationDelay: `${Math.min(0, startedAt - Date.now())}ms` }}
        />
      </span>
      <span className="toast-text">{text}</span>
      <ToastUndo onClick={onUndo} />
    </div>
  );
}
