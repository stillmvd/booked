import { memo, useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { folderDragId } from "../lib/dragIds";
import { itemDomId } from "../lib/itemDomId";
import { FOLDER_PATH } from "../lib/silhouette";
import type { Folder, FolderMatch } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface FolderRowProps {
  folder: Folder;
  compact: boolean;
  tabIndex: number;
  match?: FolderMatch;
  dragDisabled?: boolean;
  dropDisabled?: boolean;
  dropTarget?: boolean;
  noDrop?: boolean;
  onOpen: (folder: Folder) => void;
}

export const FolderRow = memo(function FolderRow({
  folder,
  compact,
  tabIndex,
  match,
  dragDisabled,
  dropDisabled,
  dropTarget,
  noDrop,
  onOpen,
}: FolderRowProps) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: folderDragId(folder.id),
    disabled: dragDisabled,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: folder.id,
    disabled: dropDisabled,
  });
  const setNodeRef = useCallback(
    (el: HTMLButtonElement | null) => {
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef],
  );
  return (
    <div className={"row-slot" + (isDragging ? " dragging-origin" : "")}>
      <button
        type="button"
        className={
          "row " +
          (compact ? "row-compact" : "row-list") +
          (dropTarget ? " drop-target" : "") +
          (noDrop ? " no-drop" : "")
        }
        data-item
        id={itemDomId("folder", folder.id)}
        aria-haspopup="menu"
        ref={setNodeRef}
        onClick={() => onOpen(folder)}
        {...listeners}
        {...attributes}
        tabIndex={tabIndex}
      >
        <span className={"row-thumb" + (compact ? " mini" : " wide")}>
          <svg
            className="row-folder-glyph"
            viewBox="0 0 168 124"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <path d={FOLDER_PATH} />
          </svg>
        </span>
        <span className="row-name">{match ? <Highlighted text={match.nameHighlighted} /> : folder.name}</span>
        {match && match.path.length > 0 && <span className="row-host">{match.path.join(" / ")}</span>}
        <span className="row-count">{folder.count}</span>
      </button>
    </div>
  );
});
