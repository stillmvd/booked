import { useCallback, useEffect, useRef } from "react";

export function useDropHighlight(attr = "data-image-over") {
  const current = useRef<HTMLElement | null>(null);

  const mark = useCallback(
    (next: HTMLElement | null) => {
      if (current.current === next) return;
      current.current?.removeAttribute(attr);
      next?.setAttribute(attr, "");
      current.current = next;
    },
    [attr],
  );

  useEffect(() => {
    const clear = () => mark(null);
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear, true);
    return () => {
      document.removeEventListener("dragend", clear);
      document.removeEventListener("drop", clear, true);
    };
  }, [mark]);

  return mark;
}
