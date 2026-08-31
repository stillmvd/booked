import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { imagePath } from "../lib/api";
import { itemDomId } from "../lib/itemDomId";
import { plate } from "../lib/plate";
import { FOLDER_PATH } from "../lib/silhouette";
import type { Folder, FolderMatch } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface FolderTileProps {
  folder: Folder;
  tabIndex: number;
  match?: FolderMatch;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function FolderTile({ folder, tabIndex, match, onOpen, onEdit, onDelete }: FolderTileProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!folder.image) {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    imagePath(folder.image).then((full) => {
      if (!cancelled) setImageSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [folder.image]);

  const swatch = plate(folder.name);

  return (
    <div className="folder-slot">
      <button
        type="button"
        className={"folder" + (imageSrc ? " banner" : " badge")}
        data-item
        id={itemDomId("folder", folder.id)}
        tabIndex={tabIndex}
        onClick={onOpen}
      >
        <svg className="sil" viewBox="0 0 168 124" width="168" height="124" aria-hidden="true">
          <path d={FOLDER_PATH} />
        </svg>
        {imageSrc && (
          <span
            className="folder-cover"
            style={{ backgroundImage: `url(${imageSrc})`, clipPath: `path('${FOLDER_PATH}')` }}
          />
        )}
        <span className="folder-inner">
          {!imageSrc && (
            <span className="folder-badge" style={{ background: swatch.bg, color: swatch.fg }}>
              {folder.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="folder-foot">
            <span className="folder-name">{match ? <Highlighted text={match.nameHighlighted} /> : folder.name}</span>
            <span className="folder-count">{folder.count}</span>
          </span>
        </span>
      </button>
      <span className="folder-actions">
        <button type="button" onClick={onEdit} aria-label={`Свойства папки ${folder.name}`}>
          ✎
        </button>
        <button type="button" onClick={onDelete} aria-label={`Удалить папку ${folder.name}`}>
          🗑
        </button>
      </span>
    </div>
  );
}
