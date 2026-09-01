import { useDraggable } from "@dnd-kit/core";

import { folderDragId } from "../lib/dragIds";
import { itemDomId } from "../lib/itemDomId";
import { pluralizeRu } from "../lib/pluralizeRu";
import { FOLDER_PATH } from "../lib/silhouette";
import type { Folder, FolderMatch } from "../lib/types";
import { Highlighted } from "./Highlighted";

interface FolderRowProps {
  folder: Folder;
  compact: boolean;
  tabIndex: number;
  match?: FolderMatch;
  dragDisabled?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function FolderRow({ folder, compact, tabIndex, match, dragDisabled, onOpen, onEdit, onDelete }: FolderRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: folderDragId(folder.id),
    disabled: dragDisabled,
  });
  const countLabel = pluralizeRu(folder.count, ["папка", "папки", "папок"]);

  return (
    <div className={"row-slot" + (isDragging ? " dragging-origin" : "")}>
      <button
        type="button"
        className={"row " + (compact ? "row-compact" : "row-list")}
        data-item
        id={itemDomId("folder", folder.id)}
        ref={setNodeRef}
        onClick={onOpen}
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
        <span className="row-count">
          {folder.count} {countLabel}
        </span>
      </button>
      <span className="row-actions">
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
