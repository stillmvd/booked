import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { relativeRu } from "../lib/dates";
import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { thumbState } from "../lib/thumbState";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface ListRowProps {
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

const MAX_CHIPS = 3;

export function ListRow({
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
}: ListRowProps) {
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
  const visibleTags = bookmark.tags.slice(0, MAX_CHIPS);
  const restTagCount = bookmark.tags.length - visibleTags.length;

  const matchedTags = highlight ? new Set([...highlight.matchedTags, ...(searchTags ?? [])]) : null;
  const titleMarked = Boolean(highlight?.title.includes(HIGHLIGHT_OPEN));
  const hostMarked = Boolean(highlight?.host.includes(HIGHLIGHT_OPEN));
  const reasonEligible = Boolean(highlight) && !titleMarked && !hostMarked;
  const descMatched = reasonEligible && !bookmark.description && Boolean(highlight?.snippet.includes(HIGHLIGHT_OPEN));
  const reasonText = descMatched
    ? `в описании: «${highlight!.snippet.split(HIGHLIGHT_OPEN).join("").split(HIGHLIGHT_CLOSE).join("")}»`
    : reasonEligible && highlight?.matchedInUrl
      ? "в URL"
      : null;

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
        <span className="row-thumb wide" style={{ background: swatch.bg }}>
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
            <span className="row-thumb-letter" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
          {state === "pending" && <span className="loading" />}
        </span>
        <span className="row-body">
          <span className="row-title-line">
            <span className="row-name">{highlight ? <Highlighted text={highlight.title} /> : bookmark.title}</span>
            <span className="row-host">{highlight ? <Highlighted text={highlight.host} /> : host}</span>
          </span>
          {reasonText && <span className="row-reason">{reasonText}</span>}
          {bookmark.description && <span className="row-desc">{bookmark.description}</span>}
        </span>
        <span className="chips">
          {visibleTags.map((tag) => (
            <span key={tag} className={"chip" + (matchedTags?.has(tag) ? " matched" : "")}>
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
