import { useLayoutEffect, useRef, useState } from "react";

import { visibleFolderCount } from "../lib/bandCap";
import { pluralizeRu } from "../lib/pluralizeRu";
import type { Folder } from "../lib/types";
import { FolderTile } from "./FolderTile";

interface FoldersBandProps {
  folders: Folder[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenFolder: (folder: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
}

export function FoldersBand({
  folders,
  collapsed,
  onToggleCollapsed,
  onOpenFolder,
  onEditFolder,
  onDeleteFolder,
}: FoldersBandProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

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
              onOpen={() => onOpenFolder(folder)}
              onEdit={() => onEditFolder(folder)}
              onDelete={() => onDeleteFolder(folder)}
            />
          ))}
        </div>
        {hasOverflow && (
          <button type="button" className="band-more" onClick={() => setExpanded((v) => !v)}>
            {expanded
              ? "Свернуть"
              : `Показать все ${folders.length} ${pluralizeRu(folders.length, ["папка", "папки", "папок"])}`}
          </button>
        )}
      </div>
    </div>
  );
}
