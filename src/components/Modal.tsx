import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { durations, useReducedMotion } from "../lib/motion.ts";

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const reduced = useReducedMotion();
  const closingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onCloseRef.current();
    }, durations(reducedRef.current).sheetOut);
  }

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const active = open && !closing;

  return (
    <div className={`modal-backdrop${active ? " open" : ""}`} onClick={requestClose}>
      <div
        className={`modal-panel${active ? " open" : ""}`}
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
