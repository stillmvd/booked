import { useEffect, useRef, useState } from "react";
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
  onFile,
  onUrl,
}: ImageDropProps) {
  const [hovering, setHovering] = useState(false);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
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

  return (
    <div className="image-drop-wrap">
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
      {src || onRefresh ? (
        <div className="image-drop-actions">
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
