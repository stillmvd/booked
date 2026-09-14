import { memo, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useDraggable } from "@dnd-kit/core";

import { mediaPath } from "../lib/api";
import { absoluteRu, relativeRu, shortRu } from "../lib/dates";
import { HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { livenessClass, livenessText } from "../lib/liveness";
import { positionStyle } from "../lib/coverFrame";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { isMultiLink } from "../lib/platforms";
import { currentTheme } from "../lib/theme";
import { thumbState } from "../lib/thumbState";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted, SplitName } from "./Highlighted";
import { Icon, PlatformIcon } from "./Icon";

interface ListRowProps {
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

const MAX_CHIPS = 3;
const MAX_PLATFORMS = 3;

export const ListRow = memo(function ListRow({
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
}: ListRowProps) {
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
  const swatch = plate(host, currentTheme());
  const state = thumbState({ image: imgOk ? resolvedSrc : null, previewPending });
  const visibleTags = bookmark.tags.slice(0, MAX_CHIPS);
  const restTagCount = bookmark.tags.length - visibleTags.length;

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
  const reasonText = reasonEligible && highlight?.matchedInUrl ? "в URL" : null;

  const multi = isMultiLink(bookmark);
  const platformLinks = bookmark.links.slice(0, MAX_PLATFORMS);
  const restLinkCount = bookmark.links.length - platformLinks.length;

  return (
    <div className={"row-slot" + (isDragging ? " dragging-origin" : "")}>
      <button
        type="button"
        className={"row row-list" + (multi ? " row-multi" : "") + (highlighted ? " row-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        ref={setNodeRef}
        onClick={() => onOpen(bookmark)}
        aria-selected={Boolean(selected)}
        {...listeners}
        {...attributes}
        tabIndex={tabIndex}
      >
        <span className={"row-thumb " + (multi ? "photo" : "wide")} style={{ background: swatch.bg }}>
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
        <span className="row-body">
          <span className="row-title-line">
            {liveness === "dead" && <Icon name="blocked" className="row-status-glyph" />}
            {liveness === "warn" && <span className="row-status-dot" />}
            {multi ? (
              <SplitName text={highlight ? highlight.title : bookmark.title} className="row-name" />
            ) : (
              <>
                <span className="row-name">{highlight ? <Highlighted text={highlight.title} /> : bookmark.title}</span>
                <span className="row-host">{highlight ? <Highlighted text={highlight.host} /> : host}</span>
              </>
            )}
          </span>
          {statusLine ? (
            <span className={"row-status-text " + liveness}>{statusLine}</span>
          ) : (
            <>
              {reasonText && <span className="row-reason">{reasonText}</span>}
              {bookmark.description && (
                <span className="row-desc">
                  {highlight && highlight.description ? <Highlighted text={highlight.description} /> : bookmark.description}
                </span>
              )}
            </>
          )}
        </span>
        {multi ? (
          <span
            className="row-platforms"
            role="img"
            aria-label={bookmark.links.map((link) => link.displayLabel).join(", ")}
          >
            {platformLinks.map((link) => (
              <span
                key={link.id}
                className={"row-platform" + (link.linkStatus === "dead" ? " dead" : "")}
                title={link.displayLabel}
              >
                <PlatformIcon platform={link.platform} />
              </span>
            ))}
            {restLinkCount > 0 && <span className="row-platform-more">+{restLinkCount}</span>}
          </span>
        ) : (
          <span className="chips">
            {visibleTags.map((tag) => (
              <span key={tag} className={"chip" + (matchedTags?.has(tag) ? " matched" : "")}>
                {tag}
              </span>
            ))}
            {restTagCount > 0 && <span className="chip more">+{restTagCount}</span>}
          </span>
        )}
        <span className="row-date" title={absoluteRu(bookmark.createdAt)}>
          {relativeRu(bookmark.createdAt, Math.floor(Date.now() / 1000))}
        </span>
      </button>
    </div>
  );
});
