import { memo, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useDraggable } from "@dnd-kit/core";

import { mediaPath } from "../lib/api";
import { absoluteRu } from "../lib/dates";
import { HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { livenessClass, livenessTooltip } from "../lib/liveness";
import { coverPosition, iconRelPath, mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { isMultiLink, linkCountLabel } from "../lib/platforms";
import { thumbState } from "../lib/thumbState";
import { currentTheme } from "../lib/theme";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted, SplitName } from "./Highlighted";
import { Icon, PlatformIcon } from "./Icon";

interface BookmarkCardProps {
  bookmark: Bookmark;
  highlighted: boolean;
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
const MAX_CARD_GLYPHS = 5;

export const BookmarkCard = memo(function BookmarkCard({
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
}: BookmarkCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bookmark.id,
    disabled: dragDisabled,
  });
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgOk = resolvedSrc !== null && loadedSrc === resolvedSrc;
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

  const livenessBadge = (
    <>
      {liveness === "dead" && (
        <span
          className="dead-glyph"
          role="img"
          title={livenessHint ?? undefined}
          aria-label={livenessHint ?? "Ссылка не открывается"}
        >
          <Icon name="blocked" />
        </span>
      )}
      {liveness === "warn" && (
        <span
          className="warn-dot"
          role="img"
          title={livenessHint ?? undefined}
          aria-label={livenessHint ?? "Со ссылкой что-то не так"}
        />
      )}
    </>
  );

  if (isMultiLink(bookmark)) {
    return (
      <div className={"card-slot" + (isDragging ? " dragging-origin" : "")}>
        <button
          type="button"
          className={"card card-multi" + (highlighted ? " card-highlight" : "")}
          data-item
          id={itemDomId("bookmark", bookmark.id)}
          ref={setNodeRef}
          onClick={() => onOpen(bookmark)}
          aria-selected={Boolean(selected)}
          {...listeners}
          {...attributes}
          tabIndex={tabIndex}
        >
          <span className="thumb multi-cover" style={{ background: swatch.bg }}>
            {resolvedSrc && (
              <img
                className={
                  isIconMode
                    ? "plate-icon " + (mode === "icon-large" ? "plate-icon-large" : "plate-icon-small")
                    : "thumb-img"
                }
                src={resolvedSrc}
                alt=""
                style={
                  imgOk
                    ? { objectPosition: coverPosition(bookmark) }
                    : { display: "none" }
                }
                onLoad={handleImgLoad}
                onError={handleImgError}
              />
            )}
            {showLetter && (
              <span className="thumb-letter" style={{ color: swatch.fg }}>
                {host.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="multi-arrow">
              <Icon name="arrow-up-right" />
            </span>
            <span className="multi-count">
              <Icon name="link" />
              {linkCountLabel(bookmark.links.length)}
            </span>
            {state === "pending" && <span className="loading" />}
            {livenessBadge}
          </span>
          <span className="multi-meta">
            <span className="multi-title-row">
              <SplitName text={highlight ? highlight.title : bookmark.title} />
              <span
                className="multi-glyphs"
                role="img"
                aria-label={bookmark.links.map((link) => link.displayLabel).join(", ")}
              >
                {bookmark.links.slice(0, MAX_CARD_GLYPHS).map((link) => (
                  <PlatformIcon
                    key={link.id}
                    platform={link.platform}
                    className={"multi-glyph" + (link.linkStatus === "dead" ? " dead" : "")}
                  />
                ))}
              </span>
            </span>
            {reasonText && <span className="row-reason">{reasonText}</span>}
            {bookmark.description && (
              <span className="multi-desc">
                {highlight && highlight.description ? <Highlighted text={highlight.description} /> : bookmark.description}
              </span>
            )}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={"card-slot" + (isDragging ? " dragging-origin" : "")}>
      <button
        type="button"
        className={"card" + (highlighted ? " card-highlight" : "")}
        data-item
        id={itemDomId("bookmark", bookmark.id)}
        ref={setNodeRef}
        onClick={() => onOpen(bookmark)}
        aria-selected={Boolean(selected)}
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
              style={imgOk ? { objectPosition: coverPosition(bookmark) } : { display: "none" }}
              onLoad={handleImgLoad}
              onError={handleImgError}
            />
          )}
          {showLetter && (
            <span className="thumb-letter" style={{ color: swatch.fg }}>
              {host.charAt(0).toUpperCase()}
            </span>
          )}
          {showFullPreview && (
            <span className="card-favicon" aria-hidden="true">
              {faviconSrc && (
                <img
                  className="favicon-img"
                  src={faviconSrc}
                  alt=""
                  style={faviconOk ? undefined : { display: "none" }}
                  onLoad={() => setFaviconOk(true)}
                  onError={() => setFaviconOk(false)}
                />
              )}
              {(!faviconSrc || !faviconOk) && host.charAt(0).toUpperCase()}
            </span>
          )}
          {state === "pending" && <span className="loading" />}
          {livenessBadge}
        </span>
        <span className="card-meta">
          <SplitName text={highlight ? highlight.title : bookmark.title} className="card-title" />
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
              {restTagCount > 0 && <span className="chip more">Ещё {restTagCount}</span>}
            </span>
            <span className="card-host" title={`Добавлена ${absoluteRu(bookmark.createdAt)}`}>
              {highlight ? <Highlighted text={highlight.host} /> : host}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
});
