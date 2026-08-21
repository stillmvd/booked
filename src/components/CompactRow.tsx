import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { imagePath } from "../lib/api";
import { absoluteRu } from "../lib/dates";
import { itemDomId } from "../lib/itemDomId";
import { hostOf, plate } from "../lib/plate";
import type { Bookmark } from "../lib/types";

interface CompactRowProps {
  bookmark: Bookmark;
  highlighted?: boolean;
  tabIndex: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MAX_DOTS = 5;

export function CompactRow({ bookmark, highlighted, tabIndex, onOpen, onEdit, onDelete }: CompactRowProps) {
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
  const visibleTags = bookmark.tags.slice(0, MAX_DOTS);

  return (
    <div className="row-slot">
      <button
        type="button"
        className={"row row-compact" + (highlighted ? " row-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        tabIndex={tabIndex}
        onClick={onOpen}
      >
        <span
          className="row-thumb mini"
          style={imageSrc ? { backgroundImage: `url(${imageSrc})` } : { background: swatch.bg }}
        >
          {!imageSrc && (
            <span className="row-thumb-letter mini" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <span className="col-name">{bookmark.title}</span>
        <span className="col-host">{host}</span>
        <span className="col-added" title={absoluteRu(bookmark.createdAt)}>
          {absoluteRu(bookmark.createdAt)}
        </span>
        <span className="tag-dots">
          {visibleTags.map((tag) => (
            <span key={tag} className="tag-dot" style={{ background: plate(tag).fg }} />
          ))}
        </span>
      </button>
      <span className="row-actions">
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
