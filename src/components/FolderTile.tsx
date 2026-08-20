import { FOLDER_PATH } from "../lib/silhouette";
import { itemDomId } from "../lib/itemDomId";
import type { Folder } from "../lib/types";

interface FolderTileProps {
  folder: Folder;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function FolderTile({ folder, onOpen, onEdit, onDelete }: FolderTileProps) {
  return (
    <div className="folder-slot">
      <button
        type="button"
        className="folder"
        data-item
        id={itemDomId("folder", folder.id)}
        tabIndex={-1}
        onClick={onOpen}
      >
        <svg className="sil" viewBox="0 0 168 124" width="168" height="124" aria-hidden="true">
          <path d={FOLDER_PATH} />
        </svg>
        <span className="folder-inner">
          <span className="folder-foot">
            <span className="folder-name">{folder.name}</span>
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
