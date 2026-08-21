import { itemDomId } from "../lib/itemDomId";
import { pluralizeRu } from "../lib/pluralizeRu";
import { FOLDER_PATH } from "../lib/silhouette";
import type { Folder } from "../lib/types";

interface FolderRowProps {
  folder: Folder;
  compact: boolean;
  tabIndex: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function FolderRow({ folder, compact, tabIndex, onOpen, onEdit, onDelete }: FolderRowProps) {
  const countLabel = pluralizeRu(folder.count, ["папка", "папки", "папок"]);

  return (
    <div className="row-slot">
      <button
        type="button"
        className={"row " + (compact ? "row-compact" : "row-list")}
        data-item
        id={itemDomId("folder", folder.id)}
        tabIndex={tabIndex}
        onClick={onOpen}
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
        <span className="row-name">{folder.name}</span>
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
