import { useRef, useState } from "react";

import { coverOverflow, positionStyle, shiftPercent } from "../lib/coverFrame";

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
  overflowX: number;
  overflowY: number;
}

export function CoverFrame({ src, x, y, onChange }: CoverFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragStart | null>(null);
  const [dragging, setDragging] = useState(false);
  const [movable, setMovable] = useState({ x: false, y: false });

  function measure() {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return { x: 0, y: 0 };
    const box = frame.getBoundingClientRect();
    return coverOverflow(box.width, box.height, image.naturalWidth, image.naturalHeight);
  }

  function refreshMovable() {
    const over = measure();
    setMovable({ x: over.x > 1, y: over.y > 1 });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const over = measure();
    if (over.x <= 1 && over.y <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x,
      y,
      overflowX: over.x,
      overflowY: over.y,
    };
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    onChange(
      shiftPercent(start.x, e.clientX - start.pointerX, start.overflowX),
      shiftPercent(start.y, e.clientY - start.pointerY, start.overflowY),
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
    const over = measure();
    onChange(shiftPercent(x, -dx, over.x), shiftPercent(y, -dy, over.y));
  }

  const hint = movable.x || movable.y ? "Перетащите картинку, чтобы выбрать видимую часть" : "Картинка помещается в кадр целиком";

  return (
    <div className="cover-frame-field">
      <div
        ref={frameRef}
        className={"cover-frame" + (dragging ? " dragging" : "") + (movable.x || movable.y ? " movable" : "")}
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
          onLoad={refreshMovable}
        />
      </div>

      <div className="cover-frame-row">
        <span className="cover-frame-hint">{hint}</span>
        <div className="cover-frame-keys" role="group" aria-label="Сдвинуть кадр">
          <button type="button" aria-label="Выше" onClick={() => nudge(0, -12)}>
            ↑
          </button>
          <button type="button" aria-label="Ниже" onClick={() => nudge(0, 12)}>
            ↓
          </button>
          <button type="button" aria-label="Левее" onClick={() => nudge(-12, 0)}>
            ←
          </button>
          <button type="button" aria-label="Правее" onClick={() => nudge(12, 0)}>
            →
          </button>
          <button type="button" onClick={() => onChange(50, 50)}>
            По центру
          </button>
        </div>
      </div>
    </div>
  );
}
