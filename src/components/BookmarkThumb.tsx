import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { coverPosition, mediaSrcOf, thumbRenderMode } from "../lib/media";
import { hostOf, plate } from "../lib/plate";
import { currentTheme } from "../lib/theme";
import type { Bookmark } from "../lib/types";

interface BookmarkThumbProps {
  bookmark: Bookmark;
  className: string;
}

export function BookmarkThumb({ bookmark, className }: BookmarkThumbProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
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
    mediaPath(segments).then((full) => {
      if (!cancelled) setResolvedSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [bookmark.image, bookmark.previewFile, bookmark.previewOrigin, bookmark.previewFetchedAt, showPreview]);

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
              ? { objectPosition: coverPosition(bookmark) }
              : { display: "none" }
          }
          onLoad={() => setLoadedSrc(resolvedSrc)}
          onError={() => setLoadedSrc(null)}
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
