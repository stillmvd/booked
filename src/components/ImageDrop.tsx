import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import { ICONS, Icon } from "./Icon";

interface ImageDropProps {
  src: string | null;
  canClear: boolean;
  onPick: () => void;
  onClear: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onFile: (file: File) => void;
}

export function ImageDrop({ src, canClear, onPick, onClear, onRefresh, refreshing, onFile }: ImageDropProps) {
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      onFile(file);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [onFile]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file) onFile(file);
  }

  return (
    <div className="image-drop-wrap">
      <button
        type="button"
        className="image-drop"
        onClick={onPick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {src ? <img className="image-drop-img" src={src} alt="" /> : null}
        <MorphIcon
          icon={ICONS[hovering ? "image-plus" : "bookmark"]}
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
