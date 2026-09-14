import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";
import { Icon } from "./Icon";

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
      className={"toast toast-update" + (hiding ? " hiding" : "")}
      aria-label={`Доступна версия ${version}, открыть настройки`}
      onClick={onOpen}
    >
      <span className="toast-text">Доступна версия {version}</span>
      <span className="toast-arrow" aria-hidden="true">
        <Icon name="arrow-right" />
      </span>
    </button>
  );
}
