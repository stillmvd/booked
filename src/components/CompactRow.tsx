import { memo, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useDraggable } from "@dnd-kit/core";

import { mediaPath } from "../lib/api";
import { absoluteRu, relativeRu, shortRu } from "../lib/dates";
import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { livenessClass, livenessText } from "../lib/liveness";
import { positionStyle } from "../lib/coverFrame";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { isMultiLink } from "../lib/platforms";
import { thumbState } from "../lib/thumbState";
import { currentTheme } from "../lib/theme";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted } from "./Highlighted";
import { PlatformIcon } from "./Icon";
import { TagDots } from "./TagDots";

interface CompactRowProps {
  bookmark: Bookmark;
  highlighted?: boolean;
  tabIndex: number;
  previewPending?: boolean;
  highlight?: SearchHighlight;
  searchTags?: string[];
  dragDisabled?: boolean;
  selected?: boolean;
  onOpen: (bookmark: Bookmark) => void;
  onCacheMiss?: (id: number) => void;
}

const MAX_GLYPHS = 6;

export const CompactRow = memo(function CompactRow({
  bookmark,
  highlighted,
  tabIndex,
  previewPending,
  highlight,
  searchTags,
  dragDisabled,
  selected,
  onOpen,
  onCacheMiss,
}: CompactRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bookmark.id,
    disabled: dragDisabled,
  });
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgOk = resolvedSrc !== null && loadedSrc === resolvedSrc;
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
    setLoadedSrc(resolvedSrc);
  }

  function handleImgError() {
    setLoadedSrc(null);
    if (!bookmark.image && bookmark.previewFile && !cacheMissRetriedRef.current) {
      cacheMissRetriedRef.current = true;
      onCacheMiss?.(bookmark.id);
    }
  }

  const host = hostOf(bookmark.urlNormalized);
  const theme = currentTheme();
  const swatch = plate(host, theme);
  const state = thumbState({ image: imgOk ? resolvedSrc : null, previewPending });

  const liveness = livenessClass(bookmark);
  const statusText = liveness ? livenessText(bookmark.linkStatus, bookmark.linkReason, bookmark.httpStatus) : null;
  const statusLine =
    statusText && bookmark.lastCheckedAt !== null ? `${statusText} · проверено ${shortRu(bookmark.lastCheckedAt)}` : statusText;

  const matchedTags = useMemo(
    () => (highlight ? new Set([...highlight.matchedTags, ...(searchTags ?? [])]) : null),
    [highlight, searchTags],
  );
  const titleMarked = Boolean(highlight?.title.includes(HIGHLIGHT_OPEN));
  const hostMarked = Boolean(highlight?.host.includes(HIGHLIGHT_OPEN));
  const reasonEligible = Boolean(highlight) && !titleMarked && !hostMarked;
  const descMatched = reasonEligible && Boolean(highlight?.snippet.includes(HIGHLIGHT_OPEN));
  const reasonText = descMatched
    ? `в описании: «${highlight!.snippet.split(HIGHLIGHT_OPEN).join("").split(HIGHLIGHT_CLOSE).join("")}»`
    : reasonEligible && highlight?.matchedInUrl
      ? "в URL"
      : null;

  const multi = isMultiLink(bookmark);

  return (
    <div className={"row-slot" + (isDragging ? " dragging-origin" : "")}>
      <button
        type="button"
        className={"row row-compact" + (highlighted ? " row-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        ref={setNodeRef}
        onClick={() => onOpen(bookmark)}
        aria-selected={Boolean(selected)}
        {...listeners}
        {...attributes}
        tabIndex={tabIndex}
      >
        <span className="row-thumb-wrap">
          <span className="row-thumb" style={{ background: swatch.bg }}>
            {resolvedSrc && (
              <img
                className="row-thumb-img"
                src={resolvedSrc}
                alt=""
                style={
                  imgOk
                    ? bookmark.image
                      ? { objectPosition: positionStyle(bookmark.imageX, bookmark.imageY) }
                      : undefined
                    : { display: "none" }
                }
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
        {multi ? (
          <span className="col-host col-platforms" role="img" aria-label={bookmark.links.map((link) => link.displayLabel).join(", ")}>
            {bookmark.links.slice(0, MAX_GLYPHS).map((link) => (
              <span key={link.id} className={"row-platform" + (link.linkStatus === "dead" ? " dead" : "")}>
                <PlatformIcon platform={link.platform} />
              </span>
            ))}
            {bookmark.links.length > MAX_GLYPHS && <span className="row-chip">+{bookmark.links.length - MAX_GLYPHS}</span>}
          </span>
        ) : (
          <span className="col-host">
            <span className="row-chip">{highlight ? <Highlighted text={highlight.host} /> : host}</span>
          </span>
        )}
        <span className="col-added">
          <span className="row-chip" title={absoluteRu(bookmark.createdAt)}>
            {relativeRu(bookmark.createdAt, Math.floor(Date.now() / 1000))}
          </span>
        </span>
        <TagDots tags={bookmark.tags} theme={theme} matched={matchedTags} className="col-tags" />
      </button>
    </div>
  );
});
