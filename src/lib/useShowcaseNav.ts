import { useCallback, useLayoutEffect, useRef } from "react";

import { pickAnchor } from "./anchor";
import type { Anchor, ItemTop } from "./anchor";
import type { ViewMode } from "./types";

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

  return { scrollerRef, captureBeforeSwitch };
}
