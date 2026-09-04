import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";

interface UpdateToastProps {
  version: string;
  onOpen: () => void;
  onDone: () => void;
}

const VISIBLE_MS = 8000;

export function UpdateToast({ version, onOpen, onDone }: UpdateToastProps) {
  const [hiding, setHiding] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    const fadeMs = durations(reducedMotionRef.current).exit;
    const hideTimer = setTimeout(() => setHiding(true), VISIBLE_MS - fadeMs);
    const doneTimer = setTimeout(() => onDoneRef.current(), VISIBLE_MS);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  return (
    <button
      type="button"
      className={"info-toast update-toast" + (hiding ? " info-toast-hiding" : "")}
      onClick={onOpen}
    >
      <span className="save-toast-label">Доступна версия {version}</span>
      <span className="update-toast-hint">Открыть настройки</span>
    </button>
  );
}
