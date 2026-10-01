import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { folderTree, gridMediaPath, gridMediaSrc } from "../lib/api";
import { backgroundCoverStyle } from "../lib/coverFrame";
import { tileFolders } from "../lib/recentFolders";
import type { FolderChoice } from "../lib/recentFolders";
import type { FolderNode } from "../lib/types";
import { Icon } from "./Icon";

interface QuickFolderTilesProps {
  recent: FolderChoice[];
  selected: FolderChoice;
  onSelect: (id: number) => void;
}

export function QuickFolderTiles({ recent, selected, onSelect }: QuickFolderTilesProps) {
  const [nodes, setNodes] = useState<FolderNode[]>([]);

  useEffect(() => {
    folderTree()
      .then((tree) => setNodes(tree.nodes))
      .catch((err) => console.error(err));
  }, []);

  const tiles = tileFolders(recent, nodes);
  if (tiles.length === 0) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="quick-tiles" role="group" aria-label="Последние папки">
      {tiles.map((node) => (
        <QuickFolderTile
          key={node.id}
          node={node}
          parentName={node.parentId === null ? null : (byId.get(node.parentId)?.name ?? null)}
          selected={node.id === selected}
          onSelect={() => onSelect(node.id)}
        />
      ))}
    </div>
  );
}

interface QuickFolderTileProps {
  node: FolderNode;
  parentName: string | null;
  selected: boolean;
  onSelect: () => void;
}

function QuickFolderTile({ node, parentName, selected, onSelect }: QuickFolderTileProps) {
  const [src, setSrc] = useState(() => gridMediaSrc(node.image ? ["images", node.image] : null, node.imageZoom));

  useEffect(() => {
    if (!node.image) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    gridMediaPath(["images", node.image], node.imageZoom).then((full) => {
      if (!cancelled) setSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [node.image, node.imageZoom]);

  const label = parentName ? `${parentName} › ${node.name}` : node.name;

  return (
    <button
      type="button"
      className="quick-tile"
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
    >
      <span className="quick-tile-tab" aria-hidden="true">
        <span className="quick-tile-name">{node.name}</span>
      </span>
      <span className="quick-tile-media" aria-hidden="true">
        {src ? (
          <span
            className="quick-tile-cover"
            style={{ backgroundImage: `url(${src})`, ...backgroundCoverStyle(node.imageX, node.imageY, node.imageZoom) }}
          />
        ) : (
          <Icon name="folder" className="quick-tile-glyph" />
        )}
      </span>
    </button>
  );
}
