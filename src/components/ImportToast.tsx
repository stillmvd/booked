import { useEffect, useRef, useState } from "react";

import { durations, useReducedMotion } from "../lib/motion";
import { pluralizeRu } from "../lib/pluralizeRu";

interface ImportToastProps {
  folders: number;
  bookmarks: number;
  onDone: () => void;
}

const VISIBLE_MS = 4000;

export function ImportToast({ folders, bookmarks, onDone }: ImportToastProps) {
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

  const text = `Импортировано: ${folders} ${pluralizeRu(folders, ["папка", "папки", "папок"])}, ${bookmarks} ${pluralizeRu(bookmarks, ["закладка", "закладки", "закладок"])}`;

  return (
    <div className={"info-toast" + (hiding ? " info-toast-hiding" : "")} role="status" aria-live="polite">
      <span className="save-toast-label">{text}</span>
    </div>
  );
}
