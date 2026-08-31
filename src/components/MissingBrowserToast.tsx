import { useEffect, useRef, useState } from "react";

interface MissingBrowserToastProps {
  kind: "browser" | "profile";
  name: string;
  onDone: () => void;
}

const VISIBLE_MS = 4000;
const FADE_MS = 160;

export function MissingBrowserToast({ kind, name, onDone }: MissingBrowserToastProps) {
  const [hiding, setHiding] = useState(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const hideTimer = setTimeout(() => setHiding(true), VISIBLE_MS - FADE_MS);
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
