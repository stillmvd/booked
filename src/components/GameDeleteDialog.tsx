import { formatSize } from "../lib/gameFormat";
import type { Game } from "../lib/types";

export type GameDeleteMode = "folder" | "forget";

interface GameDeleteDialogProps {
  game: Game;
  mode: GameDeleteMode;
  titleId?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function GameDeleteDialog({ game, mode, titleId, onClose, onConfirm }: GameDeleteDialogProps) {
  const size = formatSize(game.sizeBytes);
  const folder = mode === "folder";

  return (
    <div className="folder-delete-dialog">
      <h2 id={titleId}>{folder ? `Удалить «${game.title}» с диска?` : `Убрать «${game.title}» из списка?`}</h2>

      {game.folderPath ? <p className="game-delete-path">{game.folderPath}</p> : null}

      {folder ? (
        <p>
          {size ? `Папка занимает ${size}. ` : ""}Она удалится навсегда, мимо корзины. Карточка с оценкой
          останется во вкладке «Сыграно».
        </p>
      ) : (
        <p>
          Карточка исчезнет вместе с оценкой и тегами.
          {game.folderPath ? " Папка на диске останется на месте." : ""}
        </p>
      )}

      <div className="form-actions folder-delete-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="danger-button" onClick={onConfirm}>
          {folder ? "Удалить навсегда" : "Убрать"}
        </button>
      </div>
    </div>
  );
}
