import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { absoluteRu, shortRu } from "../lib/dates";
import { itemDomId } from "../lib/itemDomId";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { thumbState } from "../lib/thumbState";
import type { Bookmark } from "../lib/types";

interface BookmarkCardProps {
  bookmark: Bookmark;
  highlighted: boolean;
  tabIndex: number;
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
  tabIndex,
  previewPending,
  dead,
  onOpen,
  onEdit,
  onDelete,
}: BookmarkCardProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const segments = mediaSrcOf({
      image: bookmark.image,
      previewFile: bookmark.previewFile,
      previewOrigin: bookmark.previewOrigin,
    });
    if (!segments) {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    mediaPath(segments).then((full) => {
      if (cancelled) return;
      const src = convertFileSrc(full);
      const probe = new Image();
      probe.onload = () => {
        if (!cancelled) setImageSrc(src);
      };
      probe.onerror = () => {
        if (!cancelled) setImageSrc(null);
      };
      probe.src = src;
    });
    return () => {
      cancelled = true;
    };
  }, [bookmark.image, bookmark.previewFile, bookmark.previewOrigin]);

  const host = hostOf(bookmark.urlNormalized);
  const swatch = plate(host);
  const mode = thumbRenderMode({
    image: bookmark.image,
    previewFile: bookmark.previewFile,
    previewOrigin: bookmark.previewOrigin,
  });
  const state = thumbState({ image: imageSrc, previewPending });
  const isIconMode = mode === "icon-large" || mode === "icon-small";
  const showFullPreview = state === "preview" && !isIconMode;
  const showIcon = state === "preview" && isIconMode;
  const showLetter = !showFullPreview && !showIcon;
  const visibleTags = bookmark.tags.slice(0, MAX_CHIPS);
  const restTagCount = bookmark.tags.length - visibleTags.length;

  return (
    <div className="card-slot">
      <button
        type="button"
        className={"card" + (highlighted ? " card-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        tabIndex={tabIndex}
        onClick={onOpen}
      >
        <span
          className="thumb"
          style={showFullPreview ? { backgroundImage: `url(${imageSrc})` } : { background: swatch.bg }}
        >
          {showIcon && imageSrc && (
            <img
              className={"plate-icon " + (mode === "icon-large" ? "plate-icon-large" : "plate-icon-small")}
              src={imageSrc}
              alt=""
            />
          )}
          {showLetter && (
            <span className="thumb-letter" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="host-overlay">
            {showFullPreview && <span className="favicon">{host.charAt(0).toUpperCase()}</span>}
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
