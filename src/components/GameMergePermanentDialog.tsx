import { permanentQuestion } from "../lib/gameVersions";
import { DialogFact, DialogHead, DialogPocket } from "./DialogHead";
import { Icon } from "./Icon";

interface GameMergePermanentDialogProps {
  folder: string;
  bytes: number;
  titleId: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function GameMergePermanentDialog({ folder, bytes, titleId, busy, onClose, onConfirm }: GameMergePermanentDialogProps) {
  return (
    <div className="dialog game-merge-permanent">
      <DialogHead id={titleId} title="Удалить навсегда?" onClose={onClose} />
      <DialogPocket className="game-merge-facts">
        <DialogFact icon="trash" danger>
          {permanentQuestion(folder, bytes)} — папка <b>{folder}</b> удалится мимо неё, вернуть не получится
        </DialogFact>
        <DialogFact icon="shield">Если в ней были сохранения, они уже скопированы в папку, которая остаётся</DialogFact>
        <DialogFact icon="check">Если отказаться, карточки останутся как были</DialogFact>
      </DialogPocket>
      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Не удалять
        </button>
        <button type="button" className="danger-button game-delete-confirm" disabled={busy} onClick={onConfirm}>
          <Icon name="trash" />
          Удалить навсегда
        </button>
      </div>
    </div>
  );
}
