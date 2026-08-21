import { useCallback, useLayoutEffect, useRef } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

import { nextIndex, pickAnchor } from "./anchor";
import type { Anchor, ItemTop } from "./anchor";
import type { ViewMode } from "./types";

const NON_NAV_TARGETS = "input, textarea, select, [contenteditable], [role='dialog']";

interface CapturedAnchor {
  anchor: Anchor | null;
  hadFocus: boolean;
}

export function useShowcaseNav(mode: ViewMode) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const capturedRef = useRef<CapturedAnchor | null>(null);

  const captureBeforeSwitch = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const containerTop = scroller.getBoundingClientRect().top;
    const items: ItemTop[] = [...scroller.querySelectorAll<HTMLElement>("[data-item]")].map((el) => ({
      id: el.id,
      top: el.getBoundingClientRect().top,
    }));
    capturedRef.current = {
      anchor: pickAnchor(items, containerTop),
      hadFocus: scroller.contains(document.activeElement),
    };
  }, []);

  useLayoutEffect(() => {
    const captured = capturedRef.current;
    capturedRef.current = null;
    if (!captured?.anchor) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const el = document.getElementById(captured.anchor.id);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    scroller.scrollTop -= captured.anchor.delta;
    if (captured.hadFocus) {
      el.focus({ preventScroll: true });
    }
  }, [mode]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(NON_NAV_TARGETS)) return;

      const scroller = scrollerRef.current;
      if (!scroller) return;

      const items = [...scroller.querySelectorAll<HTMLElement>("[data-item]")];
      const active = document.activeElement as HTMLElement | null;
      const i = active ? items.indexOf(active) : -1;
      if (i < 0) return;

      const grid = active?.closest(".folder-grid, .card-grid");
      const columns = mode === "tiles" && grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 1;
      const pageStep =
        Math.max(1, Math.floor(scroller.clientHeight / (active?.offsetHeight || 1))) * columns;

      const next = nextIndex(e.key, i, items.length, columns, pageStep);
      if (next === null) return;

      e.preventDefault();
      items[next].focus();
    },
    [mode],
  );

  const onFocusWithin = useCallback((e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (!target.matches("[data-item]")) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    for (const item of scroller.querySelectorAll<HTMLElement>("[data-item]")) {
      item.tabIndex = item === target ? 0 : -1;
    }
  }, []);

  return { scrollerRef, captureBeforeSwitch, onKeyDown, onFocusWithin };
}
