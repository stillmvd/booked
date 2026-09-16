import { useEffect, useState } from "react";

import { folderContentsCount } from "../lib/api";
import { contentsChips, folderDeleteModes } from "../lib/folderDelete";
import type { ContentsCount, DeleteMode } from "../lib/types";
import { ChoiceCards } from "./ChoiceCards";
import { DialogHead, DialogPocket } from "./DialogHead";
import { SplitName } from "./Highlighted";
import { Icon } from "./Icon";

interface FolderDeleteDialogProps {
  folder: { id: number; name: string };
  parentName: string | null;
  titleId?: string;
  onClose: () => void;
  onConfirm: (mode: DeleteMode) => void;
}

export function FolderDeleteDialog({ folder, parentName, titleId, onClose, onConfirm }: FolderDeleteDialogProps) {
  const [count, setCount] = useState<ContentsCount | null>(null);
  const [mode, setMode] = useState<DeleteMode>("promote");

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
    <div className="folder-delete-dialog dialog">
      <DialogHead id={titleId} title={`Удалить «${folder.name}»?`} onClose={onClose} />

      <div className="dialog-body">
        <DialogPocket className="folder-delete-summary">
          <div className="folder-delete-card">
            <span className="row-stack" aria-hidden="true" />
            <span className="folder-delete-text">
              <span className="folder-delete-name" title={folder.name}>
                <SplitName text={folder.name} />
              </span>
              <span className="folder-delete-chips" aria-busy={count === null}>
                {count === null ? (
                  <>
                    <span className="folder-delete-chip folder-delete-chip-wait" />
                    <span className="folder-delete-chip folder-delete-chip-wait" />
                  </>
                ) : isEmpty ? (
                  <span className="folder-delete-chip folder-delete-chip-dim">Пусто</span>
                ) : (
                  contentsChips(count).map((chip) => (
                    <span key={chip} className="folder-delete-chip">
                      {chip}
                    </span>
                  ))
                )}
              </span>
            </span>
          </div>
        </DialogPocket>

        {count !== null && !isEmpty ? (
          <ChoiceCards
            label="Что сделать с содержимым"
            options={folderDeleteModes(count, parentName)}
            value={mode}
            onChange={setMode}
          />
        ) : null}
      </div>

      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        {count === null ? null : isEmpty ? (
          <button type="button" className="danger-button" onClick={() => onConfirm("all")}>
            Удалить
          </button>
        ) : (
          <button type="button" className="danger-button folder-delete-confirm" onClick={() => onConfirm(mode)}>
            <Icon name="trash" />
            Удалить папку
          </button>
        )}
      </div>
    </div>
  );
}
