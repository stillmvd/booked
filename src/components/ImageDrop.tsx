import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MorphIcon } from "morphicons/react";
import { ICONS, Icon } from "./Icon";
import { looksLikeImageUrl, pickImageFile, pickImageUrl } from "../lib/imageSource";

interface ImageDropProps {
  src: string | null;
  objectPosition?: string;
  canClear: boolean;
  onPick: () => void;
  onClear: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onFrame?: () => void;
  framing?: boolean;
  frame?: ReactNode;
  row?: boolean;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
}

export function ImageDrop({
  src,
  objectPosition,
  canClear,
  onPick,
  onClear,
  onRefresh,
  refreshing,
  onFrame,
  framing,
  frame,
  row,
  onFile,
  onUrl,
}: ImageDropProps) {
  const [hovering, setHovering] = useState(false);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const frameButtonRef = useRef<HTMLButtonElement>(null);
  const hadFrame = useRef(false);

  useEffect(() => {
    const leftFrame = hadFrame.current && !frame;
    hadFrame.current = Boolean(frame);
    if (!leftFrame) return;
    const active = document.activeElement;
    if (!active || active === document.body) frameButtonRef.current?.focus({ preventScroll: true });
  }, [frame]);
  const handlers = useRef({ onFile, onUrl });
  handlers.current = { onFile, onUrl };

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const data = e.clipboardData;
      const file = pickImageFile(data?.files, data?.items);
      if (file) {
        e.preventDefault();
        handlers.current.onFile(file);
        return;
      }
      const url = pickImageUrl(data?.getData("text/uri-list") ?? "", data?.getData("text/plain") ?? "");
      if (!url || !looksLikeImageUrl(url)) return;
      e.preventDefault();
      handlers.current.onUrl(url);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).some((type) => type === "Files" || type === "text/uri-list" || type === "text/plain");
  }

  function handleDragEnter(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave() {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const file = pickImageFile(e.dataTransfer.files, e.dataTransfer.items);
    if (file) {
      onFile(file);
      return;
    }
    const url = pickImageUrl(e.dataTransfer.getData("text/uri-list"), e.dataTransfer.getData("text/plain"));
    if (url) onUrl(url);
  }

  if (frame) {
    return (
      <div
        className={over ? "image-drop-wrap drop-target" : "image-drop-wrap"}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {frame}
        {row ? null : <div className="image-drop-actions">
          {onFrame ? (
            <button
              type="button"
              className="icon-btn image-drop-action"
              aria-pressed={true}
              aria-label="Готово, кадр выбран"
              onClick={onFrame}
            >
              <Icon name="crop" />
            </button>
          ) : null}
          {!onFrame ? (
            <button type="button" className="icon-btn image-drop-action" onClick={onPick} aria-label="Заменить картинку">
              <Icon name="image-plus" />
            </button>
          ) : null}
          {!onFrame && canClear ? (
            <button type="button" className="icon-btn image-drop-action" onClick={onClear} aria-label="Убрать картинку">
              <Icon name="close" />
            </button>
          ) : null}
        </div>}
      </div>
    );
  }

  return (
    <div className={row ? "image-drop-wrap image-drop-with-row" : "image-drop-wrap"}>
      <button
        type="button"
        className={over ? "image-drop drop-target" : "image-drop"}
        onClick={onPick}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {src ? <img className="image-drop-img" src={src} alt="" style={{ objectPosition }} /> : null}
        <MorphIcon
          icon={ICONS[hovering || over ? "image-plus" : "bookmark"]}
          viewBox="0 0 16 16"
          size={16}
          strokeWidth={1.5}
          spring="snappy"
          reducedMotion="user"
          className={src ? "icon image-drop-glyph image-drop-glyph-over" : "icon image-drop-glyph"}
        />
      </button>
      {row ? (
        src || onRefresh ? (
          <div className="image-drop-row">
            <button type="button" className="link-button" onClick={onPick}>
              <Icon name="image" />
              {src ? "Заменить" : "Выбрать"}
            </button>
            {onFrame && src ? (
              <button ref={frameButtonRef} type="button" className="link-button" onClick={onFrame}>
                <Icon name="crop" />
                Кадр
              </button>
            ) : null}
            {onRefresh ? (
              <button type="button" className="link-button" onClick={onRefresh} disabled={refreshing}>
                <Icon name="reset" />
                Со страницы
              </button>
            ) : null}
            {canClear ? (
              <button type="button" className="link-button image-drop-clear" onClick={onClear}>
                Убрать
              </button>
            ) : null}
          </div>
        ) : null
      ) : src || onRefresh ? (
        <div className="image-drop-actions">
          {onFrame && src ? (
            <button
              type="button"
              className="icon-btn image-drop-action"
              aria-pressed={framing === true}
              aria-label="Настроить кадр"
              onClick={onFrame}
            >
              <Icon name="crop" />
            </button>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              className="icon-btn image-drop-action"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Обновить из страницы"
            >
              <Icon name="reset" />
            </button>
          ) : null}
          {canClear ? (
            <button type="button" className="icon-btn image-drop-action" onClick={onClear} aria-label="Убрать картинку">
              <Icon name="close" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
