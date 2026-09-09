import { useEffect, useState } from "react";

import { gameExeList } from "../lib/api";
import type { Game } from "../lib/types";
import { userMessage } from "../lib/userMessage";

interface GameExeDialogProps {
  game: Game;
  titleId?: string;
  onClose: () => void;
  onPick: (path: string) => void;
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function GameExeDialog({ game, titleId, onClose, onPick }: GameExeDialogProps) {
  const [items, setItems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    gameExeList(game.id)
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((err) => {
        if (alive) setError(userMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [game.id]);

  return (
    <div className="game-exe-dialog">
      <h2 id={titleId}>Чем запускать «{game.title}»?</h2>

      {error ? (
        <p className="games-warning">{error}</p>
      ) : items === null ? (
        <p>Смотрим, что лежит в папке…</p>
      ) : items.length === 0 ? (
        <p>В папке игры нет ни одного файла, который можно запустить.</p>
      ) : (
        <ul className="game-exe-list">
          {items.map((path) => (
            <li key={path}>
              <button
                type="button"
                className={path === game.exePath ? "active" : ""}
                aria-pressed={path === game.exePath}
                onClick={() => onPick(path)}
              >
                <span className="game-exe-name">{fileName(path)}</span>
                {fileName(path) === path ? null : <span className="game-exe-path">{path}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
