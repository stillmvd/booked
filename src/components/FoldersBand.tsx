import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";

import { visibleFolderCount } from "../lib/bandCap";
import { BAND_MORE_DROP_ID } from "../lib/dragIds";
import { itemDomId } from "../lib/itemDomId";
import { pluralizeRu } from "../lib/pluralizeRu";
import type { Folder, FolderMatch } from "../lib/types";
import { FolderTile } from "./FolderTile";

const SPRING_LOAD_MS = 300;

interface VerticalLine {
  left: number;
  top: number;
  height: number;
}

interface FoldersBandProps {
  folders: Folder[];
  collapsed: boolean;
  firstItemId: string | null;
  folderMatches?: Record<number, FolderMatch>;
  dragDisabled?: boolean;
  insertionLineVertical?: VerticalLine | null;
  dropTargetFolderId?: number | null;
  noDropFolderId?: number | null;
  onToggleCollapsed: () => void;
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
}

export function FoldersBand({
  folders,
  collapsed,
  firstItemId,
  folderMatches,
  dragDisabled,
  insertionLineVertical,
  dropTargetFolderId,
  noDropFolderId,
  onToggleCollapsed,
  onOpenFolder,
  onEditFolder,
  onDeleteFolder,
}: FoldersBandProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const { setNodeRef: setMoreDropRef, isOver: overBandMore } = useDroppable({ id: BAND_MORE_DROP_ID });

  useEffect(() => {
    if (!overBandMore || expanded) return;
    const timer = window.setTimeout(() => setExpanded(true), SPRING_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [overBandMore, expanded]);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cap = visibleFolderCount(width, folders.length);
  const hasOverflow = folders.length > cap;
  const visible = expanded ? folders.length : cap;
  const shown = folders.slice(0, visible);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const foot = el.querySelector<HTMLElement>(".folder-foot");
    if (!foot) return;
    const bannerHeight = 124 - 12 - foot.offsetHeight - 12;
    el.style.setProperty("--folder-banner-h", `${bannerHeight}px`);
  }, [shown.length]);

  return (
    <div className="folders-section">
      <button
        type="button"
        className={"band-head" + (collapsed ? " collapsed" : "")}
        onClick={onToggleCollapsed}
      >
        <span className="chev">▾</span>
        <span>Папки · {folders.length}</span>
      </button>
      <div className="band-body">
        <div className="folder-grid" ref={gridRef}>
          {shown.map((folder) => (
            <FolderTile
              key={folder.id}
              folder={folder}
              tabIndex={itemDomId("folder", folder.id) === firstItemId ? 0 : -1}
              match={folderMatches?.[folder.id]}
              dragDisabled={dragDisabled}
              dropTarget={dropTargetFolderId === folder.id}
              noDrop={noDropFolderId === folder.id}
              onOpen={() => onOpenFolder(folder)}
              onEdit={() => onEditFolder(folder)}
              onDelete={() => onDeleteFolder(folder)}
            />
          ))}
          {insertionLineVertical && (
            <div
              className="insertion-line vertical"
              style={{ left: insertionLineVertical.left, top: insertionLineVertical.top, height: insertionLineVertical.height }}
            />
          )}
        </div>
        {hasOverflow && (
          <button
            type="button"
            className="band-more"
            ref={setMoreDropRef}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Свернуть"
              : `Показать все ${folders.length} ${pluralizeRu(folders.length, ["папка", "папки", "папок"])}`}
          </button>
        )}
      </div>
    </div>
  );
}
