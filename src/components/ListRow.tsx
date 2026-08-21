import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { imagePath } from "../lib/api";
import { relativeRu } from "../lib/dates";
import { itemDomId } from "../lib/itemDomId";
import { hostOf, plate } from "../lib/plate";
import type { Bookmark } from "../lib/types";

interface ListRowProps {
  bookmark: Bookmark;
  highlighted?: boolean;
  tabIndex: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MAX_CHIPS = 3;

export function ListRow({ bookmark, highlighted, tabIndex, onOpen, onEdit, onDelete }: ListRowProps) {
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
  const hasImage = !!imageSrc;
  const visibleTags = bookmark.tags.slice(0, MAX_CHIPS);
  const restTagCount = bookmark.tags.length - visibleTags.length;

  return (
    <div className="row-slot">
      <button
        type="button"
        className={"row row-list" + (highlighted ? " row-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        tabIndex={tabIndex}
        onClick={onOpen}
      >
        <span
          className="row-thumb wide"
          style={hasImage ? { backgroundImage: `url(${imageSrc})` } : { background: swatch.bg }}
        >
          {!hasImage && (
            <span className="row-thumb-letter" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <span className="row-body">
          <span className="row-title-line">
            <span className="row-name">{bookmark.title}</span>
            <span className="row-host">{host}</span>
          </span>
          {bookmark.description && <span className="row-desc">{bookmark.description}</span>}
        </span>
        <span className="chips">
          {visibleTags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
          {restTagCount > 0 && <span className="chip more">+{restTagCount}</span>}
        </span>
        <span className="row-date">{relativeRu(bookmark.createdAt, Math.floor(Date.now() / 1000))}</span>
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
