import { useEffect, useRef, useState } from "react";

import { coverOverflow, positionStyle, shiftPercent } from "../lib/coverFrame";
import type { Overflow } from "../lib/coverFrame";

interface CoverFrameProps {
  src: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}

interface DragStart {
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  overflow: Overflow;
}

export function CoverFrame({ src, x, y, onChange }: CoverFrameProps) {
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

  const movableX = room.x > 1;
  const movableY = room.y > 1;
  const hint = movableX && movableY
    ? "Перетащите картинку — в кадр попадёт то, что видно"
    : movableY
      ? "Картинка ровно по ширине кадра — двигается только вверх и вниз"
      : movableX
        ? "Картинка ровно по высоте кадра — двигается только влево и вправо"
        : "Картинка совпадает с кадром — двигать нечего";

  return (
    <div className="cover-frame-field">
      <div
        ref={frameRef}
        className={
          "cover-frame" + (dragging ? " dragging" : "") + (movableX || movableY ? " movable" : "")
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          ref={imageRef}
          src={src}
          alt=""
          draggable={false}
          style={{ objectPosition: positionStyle(x, y) }}
          onLoad={refresh}
        />
      </div>

      <div className="cover-frame-row">
        <span className="cover-frame-hint">{hint}</span>
        <div className="cover-frame-keys" role="group" aria-label="Сдвинуть кадр">
          <button type="button" aria-label="Выше" disabled={!movableY || y >= 100} onClick={() => nudge(0, -12)}>
            ↑
          </button>
          <button type="button" aria-label="Ниже" disabled={!movableY || y <= 0} onClick={() => nudge(0, 12)}>
            ↓
          </button>
          <button type="button" aria-label="Левее" disabled={!movableX || x >= 100} onClick={() => nudge(-12, 0)}>
            ←
          </button>
          <button type="button" aria-label="Правее" disabled={!movableX || x <= 0} onClick={() => nudge(12, 0)}>
            →
          </button>
          <button type="button" disabled={!movableX && !movableY} onClick={() => onChange(50, 50)}>
            По центру
          </button>
        </div>
      </div>
    </div>
  );
}
