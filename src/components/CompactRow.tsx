import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { absoluteRu } from "../lib/dates";
import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { thumbState } from "../lib/thumbState";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface CompactRowProps {
  bookmark: Bookmark;
  highlighted?: boolean;
  tabIndex: number;
  previewPending?: boolean;
  highlight?: SearchHighlight;
  searchTags?: string[];
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCacheMiss?: (id: number) => void;
}

const MAX_DOTS = 5;

export function CompactRow({
  bookmark,
  highlighted,
  tabIndex,
  previewPending,
  highlight,
  searchTags,
  onOpen,
  onEdit,
  onDelete,
  onCacheMiss,
}: CompactRowProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(false);
  const cacheMissRetriedRef = useRef(false);
  const showPreview =
    thumbRenderMode({
      image: bookmark.image,
      previewFile: bookmark.previewFile,
      previewOrigin: bookmark.previewOrigin,
    }) === "preview";

  useEffect(() => {
    const segments = showPreview
      ? mediaSrcOf({ image: bookmark.image, previewFile: bookmark.previewFile, previewOrigin: bookmark.previewOrigin })
      : null;
    setImgOk(false);
    if (!segments) {
      setResolvedSrc(null);
      return;
    }
    let cancelled = false;
    mediaPath(segments).then((full) => {
      if (!cancelled) setResolvedSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [bookmark.image, bookmark.previewFile, bookmark.previewOrigin, bookmark.previewFetchedAt, showPreview]);

  function handleImgLoad() {
    setImgOk(true);
  }

  function handleImgError() {
    setImgOk(false);
    if (!bookmark.image && bookmark.previewFile && !cacheMissRetriedRef.current) {
      cacheMissRetriedRef.current = true;
      onCacheMiss?.(bookmark.id);
    }
  }

  const host = hostOf(bookmark.urlNormalized);
  const swatch = plate(host);
  const state = thumbState({ image: imgOk ? resolvedSrc : null, previewPending });
  const visibleTags = bookmark.tags.slice(0, MAX_DOTS);

  const matchedTags = highlight ? new Set([...highlight.matchedTags, ...(searchTags ?? [])]) : null;
  const titleMarked = Boolean(highlight?.title.includes(HIGHLIGHT_OPEN));
  const hostMarked = Boolean(highlight?.host.includes(HIGHLIGHT_OPEN));
  const reasonEligible = Boolean(highlight) && !titleMarked && !hostMarked;
  const descMatched = reasonEligible && Boolean(highlight?.snippet.includes(HIGHLIGHT_OPEN));
  const reasonText = descMatched
    ? `в описании: «${highlight!.snippet.split(HIGHLIGHT_OPEN).join("").split(HIGHLIGHT_CLOSE).join("")}»`
    : reasonEligible && highlight?.matchedInUrl
      ? "в URL"
      : null;

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
        <span className="row-thumb mini" style={{ background: swatch.bg }}>
          {resolvedSrc && (
            <img
              className="row-thumb-img"
              src={resolvedSrc}
              alt=""
              style={imgOk ? undefined : { display: "none" }}
              onLoad={handleImgLoad}
              onError={handleImgError}
            />
          )}
          {!imgOk && (
            <span className="row-thumb-letter mini" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
          {state === "pending" && <span className="loading" />}
        </span>
        <span className="col-name-wrap">
          <span className="col-name">{highlight ? <Highlighted text={highlight.title} /> : bookmark.title}</span>
          {reasonText && <span className="row-reason">{reasonText}</span>}
        </span>
        <span className="col-host">{highlight ? <Highlighted text={highlight.host} /> : host}</span>
        <span className="col-added" title={absoluteRu(bookmark.createdAt)}>
          {absoluteRu(bookmark.createdAt)}
        </span>
        <span className="tag-dots">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="tag-dot"
              style={{ background: matchedTags?.has(tag) ? "var(--vanilla)" : plate(tag).fg }}
            />
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
