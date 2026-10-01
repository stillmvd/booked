import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { forgetThumb, gridMediaPath, gridMediaSrc, knownMediaSrc, markShown, shownBefore } from "../lib/api";
import { coverStyleOf, mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { currentTheme } from "../lib/theme";
import type { Bookmark } from "../lib/types";

interface BookmarkThumbProps {
  bookmark: Bookmark;
  className: string;
}

export function BookmarkThumb({ bookmark, className }: BookmarkThumbProps) {
  const [resolvedSrc, setResolvedSrc] = useState(() =>
    gridMediaSrc(thumbRenderMode(bookmark) === "preview" ? mediaSrcOf(bookmark) : null, bookmark.imageZoom),
  );
  const [loadedSrc, setLoadedSrc] = useState(() => shownBefore(resolvedSrc));
  const imgOk = resolvedSrc !== null && loadedSrc === resolvedSrc;
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
    gridMediaPath(segments, bookmark.imageZoom).then((full) => {
      if (!cancelled) setResolvedSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [bookmark.image, bookmark.previewFile, bookmark.previewOrigin, bookmark.previewFetchedAt, bookmark.imageZoom, showPreview]);

  const host = hostOf(bookmark.urlNormalized);
  const swatch = plate(host, currentTheme());

  return (
    <span className={className} style={{ background: swatch.bg }}>
      {resolvedSrc && (
        <img
          className={`${className}-img`}
          src={resolvedSrc}
          alt=""
          style={
            imgOk
              ? coverStyleOf(bookmark)
              : { display: "none" }
          }
          onLoad={() => {
            setLoadedSrc(resolvedSrc);
            markShown(resolvedSrc);
          }}
          onError={() => {
            const segments = mediaSrcOf(bookmark);
            if (forgetThumb(segments)) setResolvedSrc(knownMediaSrc(segments));
            else setLoadedSrc(null);
          }}
        />
      )}
      {!imgOk && (
        <span className={`${className}-letter`} style={{ color: swatch.fg }}>
          {host.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
