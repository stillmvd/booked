import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";
import type { IconName } from "./Icon";
import { ToastAction } from "./ToastParts";

interface GameOfferToastProps {
  text: string;
  action: { label: string; icon: IconName };
  onAction: () => void;
  onDone: () => void;
}

const VISIBLE_MS = 8000;

export function GameOfferToast({ text, action, onAction, onDone }: GameOfferToastProps) {
  const [hiding, setHiding] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    if (held) {
      setHiding(false);
      return;
    }
    const fadeMs = durations(reducedMotionRef.current).exit;
    const hideTimer = setTimeout(() => setHiding(true), VISIBLE_MS - fadeMs);
    const doneTimer = setTimeout(() => onDoneRef.current(), VISIBLE_MS);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(doneTimer);
    };
  }, [held]);

  return (
    <div
      className={"toast" + (hiding ? " hiding" : "")}
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="toast-text">{text}</span>
      <ToastAction label={action.label} icon={action.icon} onClick={onAction} />
    </div>
  );
}
