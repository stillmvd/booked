import { useEffect, useRef, useState } from "react";

import { frameWindow, percentFromOffset, windowOffset } from "../lib/coverFrame";

const RATIO = 16 / 9;

interface CoverFrameProps {
  src: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}

interface Shown {
  width: number;
  height: number;
}

interface DragStart {
  pointerX: number;
  pointerY: number;
  left: number;
  top: number;
}

export function CoverFrame({ src, x, y, onChange }: CoverFrameProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragStart | null>(null);
  const [shown, setShown] = useState<Shown>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  function measure() {
    const image = imageRef.current;
    if (!image) return;
    const box = image.getBoundingClientRect();
    setShown({ width: box.width, height: box.height });
  }

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [src]);

  const win = frameWindow(shown.width, shown.height, RATIO);
  const roomX = Math.max(0, shown.width - win.width);
  const roomY = Math.max(0, shown.height - win.height);
  const left = windowOffset(shown.width, win.width, x);
  const top = windowOffset(shown.height, win.height, y);
  const movable = roomX > 1 || roomY > 1;

  function apply(nextLeft: number, nextTop: number) {
    onChange(
      percentFromOffset(shown.width, win.width, nextLeft),
      percentFromOffset(shown.height, win.height, nextTop),
    );
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!movable) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, left, top };
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    apply(start.left + (e.clientX - start.pointerX), start.top + (e.clientY - start.pointerY));
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
    apply(left + dx, top + dy);
  }

  const atTop = roomY > 1 && top <= 0.5;
  const atBottom = roomY > 1 && top >= roomY - 0.5;
  const atLeft = roomX > 1 && left <= 0.5;
  const atRight = roomX > 1 && left >= roomX - 0.5;

  const hint = !movable
    ? "Картинка помещается в кадр целиком — двигать нечего"
    : atTop || atBottom || atLeft || atRight
      ? "Дальше в эту сторону картинка кончилась"
      : "Перетащите рамку — то, что внутри, попадёт на карточку";

  return (
    <div className="cover-frame-field">
      <div className="cover-picker">
        <img ref={imageRef} src={src} alt="" draggable={false} onLoad={measure} />
        <div
          className={"cover-window" + (dragging ? " dragging" : "") + (movable ? " movable" : "")}
          style={{ left, top, width: win.width, height: win.height }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>

      <div className="cover-frame-row">
        <span className="cover-frame-hint">{hint}</span>
        <div className="cover-frame-keys" role="group" aria-label="Сдвинуть кадр">
          <button type="button" aria-label="Выше" disabled={!movable || atTop} onClick={() => nudge(0, -12)}>
            ↑
          </button>
          <button type="button" aria-label="Ниже" disabled={!movable || atBottom} onClick={() => nudge(0, 12)}>
            ↓
          </button>
          <button type="button" aria-label="Левее" disabled={!movable || atLeft} onClick={() => nudge(-12, 0)}>
            ←
          </button>
          <button type="button" aria-label="Правее" disabled={!movable || atRight} onClick={() => nudge(12, 0)}>
            →
          </button>
          <button type="button" disabled={!movable} onClick={() => onChange(50, 50)}>
            По центру
          </button>
        </div>
      </div>
    </div>
  );
}
