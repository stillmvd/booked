import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";
import { importedText } from "../lib/restore";
import { ToastAction, ToastIcon } from "./ToastParts";

interface ImportToastProps {
  folders: number;
  bookmarks: number;
  onShow: () => void;
  onDone: () => void;
}

const VISIBLE_MS = 8000;

export function ImportToast({ folders, bookmarks, onShow, onDone }: ImportToastProps) {
  const [hiding, setHiding] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const onDoneRef = useRef(onDone);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

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
      <ToastIcon name="check" />
      <span className="toast-text">{importedText(folders, bookmarks)}</span>
      <ToastAction label="Смотреть" icon="arrow-right" onClick={onShow} />
    </div>
  );
}
