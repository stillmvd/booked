import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";

interface MissingBrowserToastProps {
  kind: "browser" | "profile";
  name: string;
  onDone: () => void;
}

const VISIBLE_MS = 4000;

export function MissingBrowserToast({ kind, name, onDone }: MissingBrowserToastProps) {
  const [hiding, setHiding] = useState(false);
  const onDoneRef = useRef(onDone);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const fadeMs = durations(reducedMotionRef.current).exit;
    const hideTimer = setTimeout(() => setHiding(true), VISIBLE_MS - fadeMs);
    const doneTimer = setTimeout(() => onDoneRef.current(), VISIBLE_MS);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  const text = kind === "profile"
    ? `Профиль ${name} больше не найден`
    : `Браузер ${name} больше не найден`;

  return (
    <div className={"info-toast" + (hiding ? " info-toast-hiding" : "")} role="status" aria-live="polite">
      <span className="save-toast-label">{text}</span>
    </div>
  );
}
