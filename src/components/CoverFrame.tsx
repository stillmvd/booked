import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  ZOOM_KEY_STEP,
  clampZoom,
  coverOverflow,
  coverSize,
  coverStyle,
  shiftPercent,
  wheelZoom,
  zoomAround,
} from "../lib/coverFrame";
import type { Overflow } from "../lib/coverFrame";
import { Icon } from "./Icon";

interface CoverFrameProps {
  src: string;
  x: number;
  y: number;
  zoom: number;
  onChange: (x: number, y: number, zoom: number) => void;
  actions?: ReactNode;
}

interface DragStart {
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  overflow: Overflow;
}

interface Sizes {
  frameWidth: number;
  frameHeight: number;
  imageWidth: number;
  imageHeight: number;
}

const NO_SIZES: Sizes = { frameWidth: 0, frameHeight: 0, imageWidth: 0, imageHeight: 0 };

export function CoverFrame({ src, x, y, zoom, onChange, actions }: CoverFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragStart | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sizes, setSizes] = useState<Sizes>(NO_SIZES);
  const latest = useRef({ x, y, zoom, onChange });
  latest.current = { x, y, zoom, onChange };

  function measure(): Sizes {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return NO_SIZES;
    return {
      frameWidth: frame.offsetWidth,
      frameHeight: frame.offsetHeight,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
    };
  }

  function overflowOf(s: Sizes, z: number): Overflow {
    return coverOverflow(s.frameWidth, s.frameHeight, s.imageWidth, s.imageHeight, z);
  }

  function refresh() {
    setSizes(measure());
  }

  function zoomTo(next: number) {
    const { x, y, zoom, onChange } = latest.current;
    const target = clampZoom(next);
    if (target === zoom) return;
    const s = measure();
    const cover = coverSize(s.frameWidth, s.frameHeight, s.imageWidth, s.imageHeight);
    onChange(
      zoomAround(x, zoom, target, s.frameWidth, cover.width),
      zoomAround(y, zoom, target, s.frameHeight, cover.height),
      target,
    );
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
    frameRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      zoomTo(wheelZoom(latest.current.zoom, e.deltaY, e.deltaMode));
    }
    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const measured = measure();
    setSizes(measured);
    const overflow = overflowOf(measured, zoom);
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
      zoom,
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
    const overflow = overflowOf(measure(), zoom);
    onChange(shiftPercent(x, -dx, overflow.x), shiftPercent(y, -dy, overflow.y), zoom);
  }

  const room = overflowOf(sizes, zoom);
  const movable = room.x > 1 || room.y > 1;
  const keyShift: Record<string, [number, number]> = {
    ArrowUp: [0, -12],
    ArrowDown: [0, 12],
    ArrowLeft: [-12, 0],
    ArrowRight: [12, 0],
  };
  const keyZoom: Record<string, number> = {
    "+": ZOOM_KEY_STEP,
    "=": ZOOM_KEY_STEP,
    "-": 1 / ZOOM_KEY_STEP,
  };

  return (
    <div
      ref={frameRef}
      className={"cover-frame cover-frame-overlay" + (dragging ? " dragging" : "") + (movable ? " movable" : "")}
      tabIndex={0}
      role="group"
      aria-label="Кадр фото: перетащите или двигайте стрелками, колесо или плюс и минус меняют масштаб"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        const factor = e.ctrlKey || e.metaKey || e.altKey ? undefined : keyZoom[e.key];
        if (factor) {
          e.preventDefault();
          zoomTo(zoom * factor);
          return;
        }
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
        style={coverStyle(x, y, zoom)}
        onLoad={refresh}
      />
      {movable ? (
        <span className="cover-frame-capsule">
          <Icon name="move" />
          Перетащите картинку
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
