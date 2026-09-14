import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { gameExeList } from "../lib/api";
import type { Game } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { DialogHead, DialogPocket } from "./DialogHead";

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

  async function browse() {
    if (game.folderPath === null) return;
    const picked = await open({
      multiple: false,
      directory: false,
      defaultPath: game.folderPath,
      filters: [{ name: "Программа", extensions: ["exe"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    onPick(picked);
  }

  return (
    <div className="game-exe-dialog dialog">
      <DialogHead id={titleId} title={`Чем запускать «${game.title}»?`} onClose={onClose} />

      <div className="dialog-body">
        {error ? (
          <p className="games-warning">{error}</p>
        ) : items === null ? (
          <DialogPocket className="dialog-note">
            <p>Смотрим, что лежит в папке…</p>
          </DialogPocket>
        ) : items.length === 0 ? (
          <DialogPocket className="dialog-note">
            <p>В папке игры нет ни одного файла, который можно запустить — найдите его сами через «Обзор…».</p>
          </DialogPocket>
        ) : (
          <DialogPocket className="game-exe-pocket">
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
          </DialogPocket>
        )}
      </div>

      <div className="form-actions">
        {game.folderPath === null ? null : (
          <button type="button" className="form-actions-lead" onClick={browse}>
            Обзор…
          </button>
        )}
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
