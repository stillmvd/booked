import { useCallback, useLayoutEffect, useRef } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

import { nextIndex, pickAnchor, TOP_BOUNDARY } from "./anchor";
import type { Anchor, ItemTop } from "./anchor";
import type { ViewMode } from "./types";

const NON_NAV_TARGETS = "input, textarea, select, [contenteditable], [role='dialog']";
const NAV_KEYS = new Set(["Home", "End", "PageUp", "PageDown", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

interface CapturedAnchor {
  anchor: Anchor | null;
  focusId: string | null;
}

export function useShowcaseNav(mode: ViewMode, onTopBoundary?: () => void) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const capturedRef = useRef<CapturedAnchor | null>(null);
  const lastItemIdRef = useRef<string | null>(null);
  const columnsRef = useRef<{ grid: Element; width: number; columns: number } | null>(null);
  const onTopBoundaryRef = useRef(onTopBoundary);
  onTopBoundaryRef.current = onTopBoundary;

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
      focusId: scroller.contains(document.activeElement) ? lastItemIdRef.current : null,
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
    if (captured.focusId) {
      const focusTarget = document.getElementById(captured.focusId) ?? el;
      focusTarget.focus({ preventScroll: true });
    }
  }, [mode]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.altKey) return;
      if (!NAV_KEYS.has(e.key)) return;
      const target = e.target as HTMLElement;
      if (target.closest(NON_NAV_TARGETS)) return;

      const scroller = scrollerRef.current;
      if (!scroller) return;

      const items = [...scroller.querySelectorAll<HTMLElement>("[data-item]")];
      const active = document.activeElement as HTMLElement | null;
      const i = active ? items.indexOf(active) : -1;
      if (i < 0) return;

      const paging = e.key === "PageUp" || e.key === "PageDown";
      const grid = paging || e.key === "ArrowUp" || e.key === "ArrowDown" ? active?.closest(".folder-grid, .card-grid") : null;
      let columns = 1;
      if (mode === "tiles" && grid) {
        const width = grid.clientWidth;
        const cached = columnsRef.current;
        columns =
          cached && cached.grid === grid && cached.width === width
            ? cached.columns
            : getComputedStyle(grid).gridTemplateColumns.split(" ").length;
        columnsRef.current = { grid, width, columns };
      }
      const pageStep = paging
        ? Math.max(1, Math.floor(scroller.clientHeight / (active?.offsetHeight || 1))) * columns
        : 1;

      const next = nextIndex(e.key, i, items.length, columns, pageStep);
      if (next === TOP_BOUNDARY) {
        e.preventDefault();
        onTopBoundaryRef.current?.();
        return;
      }
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
    const prevId = lastItemIdRef.current;
    lastItemIdRef.current = target.id;
    const prev = prevId ? document.getElementById(prevId) : null;
    if (prev && scroller.contains(prev)) {
      if (prev !== target) prev.tabIndex = -1;
      target.tabIndex = 0;
      return;
    }
    for (const item of scroller.querySelectorAll<HTMLElement>("[data-item]")) {
      item.tabIndex = item === target ? 0 : -1;
    }
  }, []);

  return { scrollerRef, captureBeforeSwitch, onKeyDown, onFocusWithin };
}
