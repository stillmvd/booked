import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { positionStyle } from "../lib/coverFrame";
import { formatSize } from "../lib/gameFormat";
import type { Game } from "../lib/types";
import { DialogHead } from "./DialogHead";
import { SplitName } from "./Highlighted";
import { Icon, type IconName } from "./Icon";

export type GameDeleteMode = "folder" | "forget";

interface GameDeleteDialogProps {
  game: Game;
  mode: GameDeleteMode;
  titleId?: string;
  onClose: () => void;
  onConfirm: () => void;
}

interface Consequence {
  icon: IconName;
  danger: boolean;
  text: string;
}

export function GameDeleteDialog({ game, mode, titleId, onClose, onConfirm }: GameDeleteDialogProps) {
  const [cover, setCover] = useState<string | null>(null);
  const size = formatSize(game.sizeBytes);
  const folder = mode === "folder";
  const glyph: IconName = folder ? "trash" : "minus-circle";

  useEffect(() => {
    let alive = true;
    if (!game.image) {
      setCover(null);
      return;
    }
    mediaPath(["images", game.image])
      .then((full) => alive && setCover(convertFileSrc(full)))
      .catch(() => alive && setCover(null));
    return () => {
      alive = false;
    };
  }, [game.image]);

  const lines: Consequence[] = folder
    ? [
        { icon: glyph, danger: true, text: `Папка${size ? ` ${size}` : ""} удалится навсегда, мимо корзины` },
        { icon: "check", danger: false, text: "Карточка останется в «Играх» с пометкой «Папки нет на диске»" },
      ]
    : [
        { icon: glyph, danger: true, text: "Карточка исчезнет вместе с оценкой и тегами" },
        ...(game.folderPath ? [{ icon: "check" as const, danger: false, text: "Папка на диске останется на месте" }] : []),
      ];

  return (
    <div className="game-delete-dialog dialog">
      <DialogHead
        id={titleId}
        title={folder ? `Удалить «${game.title}» с диска?` : `Убрать «${game.title}» из списка?`}
        onClose={onClose}
      />

      <div className="dialog-body">
        <div className="game-delete-summary">
          <div className="game-delete-mini" data-engine={game.engine ?? undefined}>
            <span className={cover ? "game-delete-cover" : "game-delete-cover letter"} aria-hidden="true">
              {cover ? (
                <img src={cover} alt="" style={{ objectPosition: positionStyle(game.imageX, game.imageY) }} />
              ) : (
                game.title.trim().charAt(0).toUpperCase() || "?"
              )}
            </span>
            <span className="game-delete-text">
              <span className="game-delete-title">
                <SplitName text={game.title} />
              </span>
              {game.folderPath ? (
                <span className="game-delete-path" title={game.folderPath}>
                  {game.folderPath}
                </span>
              ) : null}
            </span>
            {size ? <span className="game-delete-size">{size}</span> : null}
          </div>

          <ul className="game-delete-lines">
            {lines.map((line) => (
              <li key={line.text} className="game-delete-line">
                <span className={line.danger ? "game-delete-line-icon danger" : "game-delete-line-icon"} aria-hidden="true">
                  <Icon name={line.icon} />
                </span>
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="danger-button game-delete-confirm" onClick={onConfirm}>
          <Icon name={glyph} />
          {folder ? "Удалить навсегда" : "Убрать"}
        </button>
      </div>
    </div>
  );
}
