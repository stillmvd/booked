import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { absoluteRu, shortRu } from "../lib/dates";
import { HIGHLIGHT_OPEN } from "../lib/highlight";
import { itemDomId } from "../lib/itemDomId";
import { iconRelPath, mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { thumbState } from "../lib/thumbState";
import type { Bookmark, SearchHighlight } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface BookmarkCardProps {
  bookmark: Bookmark;
  highlighted: boolean;
  tabIndex: number;
  previewPending?: boolean;
  dead?: boolean;
  highlight?: SearchHighlight;
  searchTags?: string[];
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCacheMiss?: (id: number) => void;
}

const MAX_CHIPS = 3;

export function BookmarkCard({
  bookmark,
  highlighted,
  tabIndex,
  previewPending,
  dead,
  highlight,
  searchTags,
  onOpen,
  onEdit,
  onDelete,
  onCacheMiss,
}: BookmarkCardProps) {
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
  const swatch = plate(host);
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

  const matchedTags = highlight ? new Set([...highlight.matchedTags, ...(searchTags ?? [])]) : null;
  const titleMarked = Boolean(highlight?.title.includes(HIGHLIGHT_OPEN));
  const hostMarked = Boolean(highlight?.host.includes(HIGHLIGHT_OPEN));
  const reasonEligible = Boolean(highlight) && !titleMarked && !hostMarked;
  const reasonText = reasonEligible && highlight?.matchedInUrl ? "в URL" : null;

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
          {dead && <span className="dead-glyph">⊘</span>}
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
