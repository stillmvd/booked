import type { KeyboardEvent } from "react";

import { rowSubline } from "../lib/gameVersions";
import type { Game } from "../lib/types";
import { DialogHead } from "./DialogHead";
import { GamePlate } from "./GamePlate";

interface GameVersionPickProps {
  game: Game;
  games: Game[];
  titleId: string;
  onClose: () => void;
  onPick: (oldId: number) => void;
}

export function GameVersionPick({ game, games, titleId, onClose, onPick }: GameVersionPickProps) {
  const others = games
    .filter((other) => other.id !== game.id)
    .sort((a, b) => a.title.localeCompare(b.title, "ru") || a.id - b.id);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".game-merge-row"));
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || rows.length === 0) return;
    event.preventDefault();
    rows[(at + step + rows.length) % rows.length]?.focus();
  }

  return (
    <div className="dialog game-merge-dialog game-version-pick">
      <DialogHead id={titleId} title="Новая версия какой игры?" onClose={onClose} />
      <p className="game-merge-noreason">
        Выберите старую карточку — в окне сравнения будет видно, что совпало и что перенесётся на {game.folderName ?? game.title}.
      </p>
      <div className="game-merge-list game-version-pick-list" onKeyDown={keys}>
        {others.map((other) => (
          <button key={other.id} type="button" className="game-merge-row" onClick={() => onPick(other.id)}>
            <GamePlate game={other} className="game-merge-avatar" />
            <span className="game-merge-row-text">
              <span className="game-merge-row-name game-version-pick-title">{other.title}</span>
              <span className="game-merge-row-sub">
                {[rowSubline(other, other.sizeBytes, null), other.folderPath ? other.folderName : "Папки нет на диске"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
