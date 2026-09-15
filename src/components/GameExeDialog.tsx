import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { gameExeList } from "../lib/api";
import { splitExePath } from "../lib/gameFormat";
import type { Game } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { DialogHead } from "./DialogHead";
import { Icon } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

interface GameExeDialogProps {
  game: Game;
  titleId?: string;
  onClose: () => void;
  onPick: (path: string) => void;
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

  const current = game.exePath;
  const others = items ? items.filter((path) => path !== current) : [];

  return (
    <div className="game-exe-dialog dialog">
      <DialogHead id={titleId} title={`Чем запускать «${game.title}»?`} onClose={onClose} />

      <div className="dialog-body">
        {error ? (
          <ShowcaseNote icon="alert" className="games-note-danger">
            {error}
          </ShowcaseNote>
        ) : items === null ? (
          <ShowcaseNote icon="search">Смотрим, что лежит в папке…</ShowcaseNote>
        ) : (
          <>
            {current ? (
              <div className="game-exe-current">
                <span className="game-exe-current-icon" aria-hidden="true">
                  <Icon name="play" />
                </span>
                <span className="game-exe-current-text">
                  <span className="game-exe-current-label">Сейчас запускается</span>
                  <span className="game-exe-current-name" title={current}>
                    {splitExePath(current).name}
                  </span>
                </span>
              </div>
            ) : null}

            {others.length > 0 ? (
              <>
                <p className="game-exe-sublabel" id="game-exe-others">
                  {current ? "Другие файлы в папке" : "Файлы в папке"}
                </p>
                <ul className="game-exe-list" aria-labelledby="game-exe-others">
                  {others.map((path) => {
                    const { name, folder } = splitExePath(path);
                    return (
                      <li key={path}>
                        <button type="button" className="game-exe-row" onClick={() => onPick(path)}>
                          <span className="game-exe-name">{name}</span>
                          {folder ? (
                            <span className="game-exe-folder" title={folder}>
                              {folder}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}

            {items.length === 0 ? (
              <ShowcaseNote icon="search">В папке нет программ, которые можно запустить.</ShowcaseNote>
            ) : null}
          </>
        )}
      </div>

      <div className="form-actions">
        {game.folderPath === null ? null : (
          <button type="button" className="form-actions-lead game-exe-browse" onClick={browse}>
            <Icon name="folder" />
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
