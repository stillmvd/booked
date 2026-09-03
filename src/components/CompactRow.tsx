import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useDraggable } from "@dnd-kit/core";

import { mediaPath } from "../lib/api";
import { absoluteRu, shortRu } from "../lib/dates";
import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { livenessClass, livenessText } from "../lib/liveness";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { thumbState } from "../lib/thumbState";
import { currentTheme } from "../lib/theme";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface CompactRowProps {
  bookmark: Bookmark;
  highlighted?: boolean;
  tabIndex: number;
  previewPending?: boolean;
  highlight?: SearchHighlight;
  searchTags?: string[];
  dragDisabled?: boolean;
  onOpen: () => void;
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
  dragDisabled,
  onOpen,
  onCacheMiss,
}: CompactRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bookmark.id,
    disabled: dragDisabled,
  });
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
  const theme = currentTheme();
  const swatch = plate(host, theme);
  const state = thumbState({ image: imgOk ? resolvedSrc : null, previewPending });
  const visibleTags = bookmark.tags.slice(0, MAX_DOTS);

  const liveness = livenessClass(bookmark);
  const statusText = liveness ? livenessText(bookmark.linkStatus, bookmark.linkReason, bookmark.httpStatus) : null;
  const statusLine =
    statusText && bookmark.lastCheckedAt !== null ? `${statusText} · проверено ${shortRu(bookmark.lastCheckedAt)}` : statusText;

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
    <div className={"row-slot" + (isDragging ? " dragging-origin" : "")}>
      <button
        type="button"
        className={"row row-compact" + (highlighted ? " row-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        aria-haspopup="menu"
        ref={setNodeRef}
        onClick={onOpen}
        {...listeners}
        {...attributes}
        tabIndex={tabIndex}
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
          {liveness && <span className={"row-thumb-status " + liveness} />}
        </span>
        <span className="col-name-wrap">
          <span className="col-name">{highlight ? <Highlighted text={highlight.title} /> : bookmark.title}</span>
          {statusLine ? (
            <span className={"row-status-text " + liveness}>{statusLine}</span>
          ) : (
            reasonText && <span className="row-reason">{reasonText}</span>
          )}
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
              style={{ background: matchedTags?.has(tag) ? "var(--accent)" : plate(tag, theme).fg }}
            />
          ))}
        </span>
      </button>
    </div>
  );
}
