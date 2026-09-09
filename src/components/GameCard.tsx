import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { formatLastLaunched, formatSize, updateLabel } from "../lib/gameFormat";
import type { Rect } from "../lib/menuPosition";
import type { Game, GameStatus } from "../lib/types";

const STATUS_LABELS: Record<GameStatus, string> = {
  new: "Не начата",
  playing: "Прохожу",
  finished: "Пройдена",
  dropped: "Брошена",
};

const SOURCE_LABELS: Record<string, string> = {
  f95: "F95zone",
  itch: "itch.io",
};

interface GameCardProps {
  game: Game;
  selected: boolean;
  onSelect: (id: number) => void;
  onRate: (id: number, rating: number) => void;
  onMenu: (id: number, anchor: Rect) => void;
  onLaunch: (id: number) => void;
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? "star on" : "star off"}>
      <path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
    </svg>
  );
}

export function GameCard({ game, selected, onSelect, onRate, onMenu, onLaunch }: GameCardProps) {
  const [cover, setCover] = useState<string | null>(null);
  const installed = game.folderPath !== null;
  const badge = game.hasUpdate ? updateLabel(game.source, game.siteVersion, game.versionInstalled) : "";

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

  const facts = [
    game.versionInstalled ? `Версия ${game.versionInstalled}` : "Версия не определена",
    formatSize(game.sizeBytes),
  ].filter(Boolean);

  return (
    <div
      className={"game-card" + (installed ? "" : " gone") + (selected ? " selected" : "")}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const keyboard = e.detail === 0 && e.button !== 2;
        const anchor = keyboard
          ? e.currentTarget.getBoundingClientRect()
          : { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY };
        onMenu(game.id, anchor);
      }}
    >
      <button
        type="button"
        className="game-card-open"
        aria-pressed={selected}
        onClick={() => onSelect(game.id)}
        onDoubleClick={() => {
          if (installed) onLaunch(game.id);
        }}
      >
        <span className="game-cover">
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <span className="game-cover-letter" aria-hidden="true">
              {game.title.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
          {badge ? <span className="game-badge">{badge}</span> : null}
        </span>
        <span className="game-card-body">
          <span className="game-title">{game.title}</span>
          <span className="game-facts">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </span>
          <span className="game-line">
            <span className={"game-status " + game.status}>{STATUS_LABELS[game.status]}</span>
            {game.source ? <span className="game-source">{SOURCE_LABELS[game.source]}</span> : null}
          </span>
          <span className="game-launched">
            {installed ? formatLastLaunched(game.lastLaunchedAt) : "Папки нет на диске"}
          </span>
        </span>
      </button>

      <div className="game-stars" role="group" aria-label={`Оценка игры ${game.title}`}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className="star-btn"
            aria-label={`${value} из 5`}
            aria-pressed={game.rating === value}
            onClick={() => onRate(game.id, game.rating === value ? 0 : value)}
          >
            <Star filled={value <= game.rating} />
          </button>
        ))}
      </div>

      {game.tags.length > 0 ? (
        <div className="game-tags">
          {game.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="game-tag">
              {tag}
            </span>
          ))}
          {game.tags.length > 3 ? <span className="game-tag more">+{game.tags.length - 3}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
