import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { coverOverflow, positionStyle, shiftPercent } from "../lib/coverFrame";
import type { Overflow } from "../lib/coverFrame";
import { Icon } from "./Icon";

interface CoverFrameProps {
  src: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  actions?: ReactNode;
  hint?: string;
  autoFocus?: boolean;
}

interface DragStart {
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  overflow: Overflow;
}

export function CoverFrame({
  src,
  x,
  y,
  onChange,
  actions,
  hint = "Потяни, чтобы поправить кадр",
  autoFocus,
}: CoverFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragStart | null>(null);
  const [dragging, setDragging] = useState(false);
  const [room, setRoom] = useState<Overflow>({ x: 0, y: 0 });

  function measure(): Overflow {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return { x: 0, y: 0 };
    return coverOverflow(
      frame.offsetWidth,
      frame.offsetHeight,
      image.naturalWidth,
      image.naturalHeight,
    );
  }

  function refresh() {
    setRoom(measure());
  }

  useEffect(() => {
    refresh();
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(refresh);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    if (autoFocus) frameRef.current?.focus({ preventScroll: true });
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const overflow = measure();
    setRoom(overflow);
    if (overflow.x <= 1 && overflow.y <= 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, x, y, overflow };
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    onChange(
      shiftPercent(start.x, e.clientX - start.pointerX, start.overflow.x),
      shiftPercent(start.y, e.clientY - start.pointerY, start.overflow.y),
    );
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function nudge(dx: number, dy: number) {
    const overflow = measure();
    onChange(shiftPercent(x, -dx, overflow.x), shiftPercent(y, -dy, overflow.y));
  }

  const movable = room.x > 1 || room.y > 1;
  const keyShift: Record<string, [number, number]> = {
    ArrowUp: [0, -12],
    ArrowDown: [0, 12],
    ArrowLeft: [-12, 0],
    ArrowRight: [12, 0],
  };

  return (
    <div
      ref={frameRef}
      className={"cover-frame cover-frame-overlay" + (dragging ? " dragging" : "") + (movable ? " movable" : "")}
      tabIndex={movable ? 0 : -1}
      role="group"
      aria-label="Кадр фото: перетащите или двигайте стрелками"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        const shift = keyShift[e.key];
        if (!shift) return;
        e.preventDefault();
        nudge(shift[0], shift[1]);
      }}
    >
      <img
        ref={imageRef}
        src={src}
        alt=""
        draggable={false}
        style={{ objectPosition: positionStyle(x, y) }}
        onLoad={refresh}
      />
      {movable ? (
        <span className="cover-frame-capsule">
          <Icon name="move" />
          {hint}
        </span>
      ) : null}
      {actions ? (
        <span className="cover-frame-actions" onPointerDown={(e) => e.stopPropagation()}>
          {actions}
        </span>
      ) : null}
    </div>
  );
}
