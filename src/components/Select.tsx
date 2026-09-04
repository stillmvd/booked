import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { durations, useReducedMotion } from "../lib/motion";
import { Icon } from "./Icon";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  id?: string;
}

interface Pos {
  left: number;
  top: number;
  width: number;
}

export function Select({ value, options, onChange, ariaLabel, id }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : "";

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom, width: rect.width });
  }

  function openList() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    updatePosition();
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
    rafRef.current = requestAnimationFrame(() => setShown(true));
  }

  function closeList(refocus: boolean) {
    if (!open) {
      if (refocus) triggerRef.current?.focus();
      return;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setShown(false);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setPos(null);
    }, durations(reducedRef.current).exit);
    if (refocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleScrollOrResize() {
      updatePosition();
    }
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (listRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closeList(false);
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  function selectOption(index: number) {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    closeList(true);
  }

  function handleTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openList();
    }
  }

  function handleListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectOption(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeList(true);
    } else if (e.key === "Tab") {
      closeList(false);
    }
  }

  const baseId = id ?? "select";
  const listboxId = `${baseId}-listbox`;
  const activeId = activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined;

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? activeId : undefined}
        onClick={() => (open ? closeList(true) : openList())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="select-trigger-label">{selectedLabel}</span>
        <Icon name="chevron-down" className={"select-trigger-chevron" + (shown ? " open" : "")} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              className={"select-list" + (shown ? " open" : "")}
              style={{ left: pos.left, top: pos.top, width: pos.width }}
              onKeyDown={handleListKeyDown}
            >
              {options.map((opt, i) => (
                <div
                  key={opt.value}
                  id={`${baseId}-option-${i}`}
                  role="option"
                  aria-selected={opt.value === value}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  className={"select-option" + (i === activeIndex ? " active" : "")}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => selectOption(i)}
                >
                  <span className="select-option-label">{opt.label}</span>
                  {opt.value === value ? <span className="select-option-check" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
