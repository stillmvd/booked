import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { imagePath } from "../lib/api";
import { itemDomId } from "../lib/itemDomId";
import { hostOf, plate } from "../lib/plate";
import type { Bookmark } from "../lib/types";

interface BookmarkCardProps {
  bookmark: Bookmark;
  highlighted: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function BookmarkCard({ bookmark, highlighted, onOpen, onEdit, onDelete }: BookmarkCardProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!bookmark.image) {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    imagePath(bookmark.image).then((full) => {
      if (!cancelled) setImageSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [bookmark.image]);

  const host = hostOf(bookmark.urlNormalized);
  const swatch = plate(host);

  return (
    <div className="card-slot">
      <button
        type="button"
        className={"card" + (highlighted ? " card-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        tabIndex={-1}
        onClick={onOpen}
      >
        <span
          className="thumb"
          style={imageSrc ? { backgroundImage: `url(${imageSrc})` } : { background: swatch.bg }}
        >
          {!imageSrc && (
            <span className="thumb-letter" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <span className="card-meta">
          <span className="card-title">{bookmark.title}</span>
          <span className="card-host">{host}</span>
        </span>
      </button>
      <span className="card-actions">
        <button type="button" onClick={onEdit} aria-label={`Свойства закладки ${bookmark.title}`}>
          ✎
        </button>
        <button type="button" onClick={onDelete} aria-label={`Удалить закладку ${bookmark.title}`}>
          🗑
        </button>
      </span>
    </div>
  );
}
