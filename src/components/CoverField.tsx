import { useEffect, useState } from "react";

import { positionStyle } from "../lib/coverFrame";
import { CoverFrame } from "./CoverFrame";
import { SubmitMark } from "./DialogHead";
import { ImageDrop } from "./ImageDrop";

interface CoverFieldProps {
  src: string | null;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  framable?: boolean;
  canClear: boolean;
  onPick: () => void;
  onClear: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
}

export function CoverField({
  src,
  x,
  y,
  onMove,
  framable = true,
  canClear,
  onPick,
  onClear,
  onRefresh,
  refreshing,
  onFile,
  onUrl,
}: CoverFieldProps) {
  const [framing, setFraming] = useState(false);
  const canFrame = framable && src !== null;
  const active = framing && canFrame;

  useEffect(() => {
    if (!canFrame) setFraming(false);
  }, [canFrame]);

  useEffect(() => {
    if (!active) return;
    function leaveFraming(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      e.stopPropagation();
      setFraming(false);
    }
    document.addEventListener("keydown", leaveFraming, true);
    return () => document.removeEventListener("keydown", leaveFraming, true);
  }, [active]);

  return (
    <ImageDrop
      src={src}
      objectPosition={canFrame ? positionStyle(x, y) : undefined}
      canClear={canClear}
      onPick={onPick}
      onClear={onClear}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onFrame={canFrame ? () => setFraming(true) : undefined}
      frame={
        active && src ? (
          <CoverFrame
            src={src}
            x={x}
            y={y}
            onChange={onMove}
            actions={
              <button type="button" className="cover-frame-done" onClick={() => setFraming(false)}>
                Готово
                <SubmitMark />
              </button>
            }
          />
        ) : null
      }
      row
      onFile={onFile}
      onUrl={onUrl}
    />
  );
}
