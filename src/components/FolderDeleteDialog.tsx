import { useEffect, useState } from "react";

import { folderContentsCount } from "../lib/api";
import { pluralizeRu } from "../lib/pluralizeRu";
import type { ContentsCount, DeleteMode } from "../lib/types";

interface FolderDeleteDialogProps {
  folder: { id: number; name: string };
  parentName: string | null;
  titleId?: string;
  onClose: () => void;
  onConfirm: (mode: DeleteMode) => void;
}

export function FolderDeleteDialog({ folder, parentName, titleId, onClose, onConfirm }: FolderDeleteDialogProps) {
  const [count, setCount] = useState<ContentsCount | null>(null);

  useEffect(() => {
    let cancelled = false;
    folderContentsCount(folder.id).then((c) => {
      if (!cancelled) setCount(c);
    });
    return () => {
      cancelled = true;
    };
  }, [folder.id]);

  const isEmpty = count !== null && count.bookmarks === 0 && count.folders === 0;

  return (
    <div className="folder-delete-dialog">
      <h2 id={titleId}>Удалить «{folder.name}»?</h2>

      {count === null ? (
        <p>Считаем содержимое…</p>
      ) : isEmpty ? (
        <p>Папка пуста</p>
      ) : (
        <p>
          Внутри {count.bookmarks} {pluralizeRu(count.bookmarks, ["закладка", "закладки", "закладок"])} и{" "}
          {count.folders} {pluralizeRu(count.folders, ["подпапка", "подпапки", "подпапок"])}
        </p>
      )}

      <div className="form-actions folder-delete-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        {isEmpty ? (
          <button type="button" className="danger-button" onClick={() => onConfirm("all")}>
            Удалить
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onConfirm("promote")}>
              Перенести выше
            </button>
            <button type="button" className="danger-button" onClick={() => onConfirm("all")}>
              Удалить всё
            </button>
          </>
        )}
      </div>

      {!isEmpty && (
        <p className="folder-delete-hint">
          «Перенести выше» переместит содержимое в «{parentName ?? "Trove"}»
        </p>
      )}
    </div>
  );
}
