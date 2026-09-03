import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";

interface HintToastProps {
  text: string;
  onDone: () => void;
}

const VISIBLE_MS = 4000;

export function HintToast({ text, onDone }: HintToastProps) {
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
    <div className={"info-toast" + (hiding ? " info-toast-hiding" : "")} role="status" aria-live="polite">
      <span className="save-toast-label">{text}</span>
    </div>
  );
}
