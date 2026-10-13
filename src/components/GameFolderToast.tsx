import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";
import { ToastAction } from "./ToastParts";

interface GameFolderToastProps {
  text: string;
  onDelete: () => void;
  onDone: () => void;
}

const VISIBLE_MS = 8000;

export function GameFolderToast({ text, onDelete, onDone }: GameFolderToastProps) {
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
      <ToastAction label="Удалить" icon="trash" onClick={onDelete} />
    </div>
  );
}
