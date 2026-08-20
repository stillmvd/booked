import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { imagePath } from "../lib/api";
import { absoluteRu, shortRu } from "../lib/dates";
import { itemDomId } from "../lib/itemDomId";
import { hostOf, plate } from "../lib/plate";
import { thumbState } from "../lib/thumbState";
import type { Bookmark } from "../lib/types";

interface BookmarkCardProps {
  bookmark: Bookmark;
  highlighted: boolean;
  previewPending?: boolean;
  dead?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MAX_CHIPS = 3;

export function BookmarkCard({
  bookmark,
  highlighted,
  previewPending,
  dead,
  onOpen,
  onEdit,
  onDelete,
}: BookmarkCardProps) {
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
  const state = thumbState({ image: imageSrc, previewPending });
  const hasPreview = state === "preview";
  const visibleTags = bookmark.tags.slice(0, MAX_CHIPS);
  const restTagCount = bookmark.tags.length - visibleTags.length;

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
          style={hasPreview ? { backgroundImage: `url(${imageSrc})` } : { background: swatch.bg }}
        >
          {!hasPreview && (
            <span className="thumb-letter" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="host-overlay">
            {hasPreview && <span className="favicon">{host.charAt(0).toUpperCase()}</span>}
            <span className="host-text">{host}</span>
          </span>
          {state === "pending" && <span className="loading" />}
          {dead && <span className="dead-glyph">⊘</span>}
        </span>
        <span className="card-meta">
          <span className="card-title">{bookmark.title}</span>
          {bookmark.description && <span className="card-desc">{bookmark.description}</span>}
          <span className="card-foot">
            <span className="chips">
              {visibleTags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
              {restTagCount > 0 && <span className="chip more">+{restTagCount}</span>}
            </span>
            <span className="card-date" title={absoluteRu(bookmark.createdAt)}>
              {shortRu(bookmark.createdAt)}
            </span>
          </span>
          {dead && <span className="card-status">не отвечает</span>}
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
