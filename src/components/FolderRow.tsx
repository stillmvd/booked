import { memo, useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { folderDragId } from "../lib/dragIds";
import { itemDomId } from "../lib/itemDomId";
import type { Folder, FolderMatch } from "../lib/types";
import { Highlighted } from "./Highlighted";
import { Icon } from "./Icon";

interface FolderRowProps {
  folder: Folder;
  compact: boolean;
  tabIndex: number;
  match?: FolderMatch;
  dragDisabled?: boolean;
  dropDisabled?: boolean;
  dropTarget?: boolean;
  noDrop?: boolean;
  selected?: boolean;
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
  selected,
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
  const name = match ? <Highlighted text={match.nameHighlighted} /> : folder.name;
  const path = match && match.path.length > 0 ? match.path.join(" / ") : null;
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
        ref={setNodeRef}
        onClick={() => onOpen(folder)}
        aria-selected={Boolean(selected)}
        {...listeners}
        {...attributes}
        tabIndex={tabIndex}
      >
        {compact ? (
          <>
            <span className="row-thumb-wrap">
              <span className="row-thumb row-thumb-folder">
                <Icon name="folder" />
              </span>
            </span>
            <span className="col-name-wrap">
              <span className="col-name col-folder-name">{name}</span>
              {path && <span className="row-reason">{path}</span>}
            </span>
            <span className="col-host">
              <span className="row-chip">{folder.count}</span>
            </span>
            <span className="col-added" aria-hidden="true" />
            <span className="col-tags" aria-hidden="true" />
          </>
        ) : (
          <>
            <span className="row-stack" aria-hidden="true" />
            <span className="row-body">
              <span className="row-title-line">
                <span className="row-name row-folder-name">{name}</span>
                {path && <span className="row-host">{path}</span>}
              </span>
            </span>
            <span className="row-meta">
              <span className="row-chip">{folder.count}</span>
            </span>
          </>
        )}
      </button>
    </div>
  );
});
