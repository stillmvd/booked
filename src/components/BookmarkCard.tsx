import { memo, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useDraggable } from "@dnd-kit/core";

import { mediaPath } from "../lib/api";
import { absoluteRu, relativeRu } from "../lib/dates";
import { HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { livenessClass, livenessTooltip } from "../lib/liveness";
import { iconRelPath, mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { thumbState } from "../lib/thumbState";
import { currentTheme } from "../lib/theme";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface BookmarkCardProps {
  bookmark: Bookmark;
  highlighted: boolean;
  tabIndex: number;
  previewPending?: boolean;
  highlight?: SearchHighlight;
  searchTags?: string[];
  dragDisabled?: boolean;
  onOpen: (bookmark: Bookmark) => void;
  onCacheMiss?: (id: number) => void;
}

const MAX_CHIPS = 3;

export const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  highlighted,
  tabIndex,
  previewPending,
  highlight,
  searchTags,
  dragDisabled,
  onOpen,
  onCacheMiss,
}: BookmarkCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bookmark.id,
    disabled: dragDisabled,
  });
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(false);
  const [faviconSrc, setFaviconSrc] = useState<string | null>(null);
  const [faviconOk, setFaviconOk] = useState(false);
  const cacheMissRetriedRef = useRef(false);

  useEffect(() => {
    setFaviconOk(false);
    if (!bookmark.faviconFile) {
      setFaviconSrc(null);
      return;
    }
    let cancelled = false;
    mediaPath(iconRelPath(bookmark.faviconFile)).then((full) => {
      if (!cancelled) setFaviconSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [bookmark.faviconFile]);

  useEffect(() => {
    const segments = mediaSrcOf({
      image: bookmark.image,
      previewFile: bookmark.previewFile,
      previewOrigin: bookmark.previewOrigin,
    });
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
  }, [bookmark.image, bookmark.previewFile, bookmark.previewOrigin, bookmark.previewFetchedAt]);

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
  const swatch = plate(host, currentTheme());
  const mode = thumbRenderMode({
    image: bookmark.image,
    previewFile: bookmark.previewFile,
    previewOrigin: bookmark.previewOrigin,
  });
  const state = thumbState({ image: imgOk ? resolvedSrc : null, previewPending });
  const isIconMode = mode === "icon-large" || mode === "icon-small";
  const showFullPreview = state === "preview" && !isIconMode;
  const showIcon = state === "preview" && isIconMode;
  const showLetter = !showFullPreview && !showIcon;
  const visibleTags = bookmark.tags.slice(0, MAX_CHIPS);
  const restTagCount = bookmark.tags.length - visibleTags.length;

  const liveness = livenessClass(bookmark);
  const livenessHint = livenessTooltip(bookmark.linkStatus, bookmark.linkReason, bookmark.httpStatus, bookmark.lastCheckedAt);

  const matchedTags = useMemo(
    () => (highlight ? new Set([...highlight.matchedTags, ...(searchTags ?? [])]) : null),
    [highlight, searchTags],
  );
  const titleMarked = Boolean(highlight?.title.includes(HIGHLIGHT_OPEN));
  const hostMarked = Boolean(highlight?.host.includes(HIGHLIGHT_OPEN));
  const reasonEligible = Boolean(highlight) && !titleMarked && !hostMarked;
  const reasonText = reasonEligible && highlight?.matchedInUrl ? "в URL" : null;

  return (
    <div className={"card-slot" + (isDragging ? " dragging-origin" : "")}>
      <button
        type="button"
        className={"card" + (highlighted ? " card-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        aria-haspopup="menu"
        ref={setNodeRef}
        onClick={() => onOpen(bookmark)}
        {...listeners}
        {...attributes}
        tabIndex={tabIndex}
      >
        <span className="thumb" style={{ background: swatch.bg }}>
          {resolvedSrc && (
            <img
              className={
                isIconMode
                  ? "plate-icon " + (mode === "icon-large" ? "plate-icon-large" : "plate-icon-small")
                  : "thumb-img"
              }
              src={resolvedSrc}
              alt=""
              style={imgOk ? undefined : { display: "none" }}
              onLoad={handleImgLoad}
              onError={handleImgError}
            />
          )}
          {showLetter && (
            <span className="thumb-letter" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="host-overlay">
            {showFullPreview && faviconSrc && (
              <span className="favicon">
                <img
                  className="favicon-img"
                  src={faviconSrc}
                  alt=""
                  style={faviconOk ? undefined : { display: "none" }}
                  onLoad={() => setFaviconOk(true)}
                  onError={() => setFaviconOk(false)}
                />
                {!faviconOk && host.charAt(0).toUpperCase()}
              </span>
            )}
            {showFullPreview && !faviconSrc && <span className="favicon">{host.charAt(0).toUpperCase()}</span>}
            <span className="host-text">{highlight ? <Highlighted text={highlight.host} /> : host}</span>
          </span>
          {state === "pending" && <span className="loading" />}
          {liveness === "dead" && (
            <span className="dead-glyph" title={livenessHint ?? undefined} aria-label={livenessHint ?? undefined}>
              ⊘
            </span>
          )}
          {liveness === "warn" && (
            <span className="warn-dot" title={livenessHint ?? undefined} aria-label={livenessHint ?? undefined} />
          )}
        </span>
        <span className="card-meta">
          <span className="card-title">{highlight ? <Highlighted text={highlight.title} /> : bookmark.title}</span>
          {reasonText && <span className="row-reason">{reasonText}</span>}
          {bookmark.description && (
            <span className="card-desc">
              {highlight && highlight.description ? <Highlighted text={highlight.description} /> : bookmark.description}
            </span>
          )}
          <span className="card-foot">
            <span className="chips">
              {visibleTags.map((tag) => (
                <span key={tag} className={"chip" + (matchedTags?.has(tag) ? " matched" : "")}>
                  {tag}
                </span>
              ))}
              {restTagCount > 0 && <span className="chip more">+{restTagCount}</span>}
            </span>
            <span className="card-date" title={absoluteRu(bookmark.createdAt)}>
              {relativeRu(bookmark.createdAt, Math.floor(Date.now() / 1000))}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
});
