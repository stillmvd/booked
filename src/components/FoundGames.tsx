import { memo, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { positionStyle } from "../lib/coverFrame";
import { foundGamesPage, stripWheel } from "../lib/foundGames";
import { withV } from "../lib/gameFormat";
import type { Game } from "../lib/types";
import { Icon } from "./Icon";

interface FoundGamesProps {
  games: Game[];
  onOpen: (id: number) => void;
  onShowAll: () => void;
}

const FoundGameTile = memo(function FoundGameTile({ game, onOpen }: { game: Game; onOpen: (id: number) => void }) {
  const [cover, setCover] = useState<string | null>(null);

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

  return (
    <button
      type="button"
      className={"found-game" + (game.folderPath === null ? " gone" : "")}
      data-engine={game.engine ?? undefined}
      onClick={() => onOpen(game.id)}
    >
      <span className={"found-game-cover" + (cover ? "" : " letter")}>
        {cover ? (
          <img src={cover} alt="" style={{ objectPosition: positionStyle(game.imageX, game.imageY) }} />
        ) : (
          <span aria-hidden="true">{game.title.trim().charAt(0).toUpperCase() || "?"}</span>
        )}
      </span>
      <span className="found-game-text">
        <span className="found-game-title">{game.title}</span>
        <span className="found-game-facts">
          {game.engine ? <span className="found-game-chip found-game-engine">{game.engine}</span> : null}
          {game.versionInstalled ? (
            <span className="found-game-chip found-game-shrink">
              <span className="found-game-chip-text">{withV(game.versionInstalled)}</span>
            </span>
          ) : (
            <span className="found-game-chip found-game-shrink found-game-noversion">
              <Icon name="alert" />
              <span className="found-game-chip-text">Версия неизвестна</span>
            </span>
          )}
        </span>
      </span>
    </button>
  );
});

export function FoundGames({ games, onOpen, onShowAll }: FoundGamesProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const { shown, extra } = foundGamesPage(games);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    function handleWheel(e: WheelEvent) {
      if (!strip || e.ctrlKey) return;
      const next = stripWheel(strip.scrollLeft, strip.scrollWidth, strip.clientWidth, e.deltaX, e.deltaY);
      if (next === null) return;
      e.preventDefault();
      strip.scrollLeft = next;
    }
    strip.addEventListener("wheel", handleWheel, { passive: false });
    return () => strip.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <section className="found-games" aria-label="Найденные игры">
      <h2 className="band-head">
        Игры <span className="band-head-count">{games.length}</span>
      </h2>
      <div className="found-games-strip" ref={stripRef}>
        {shown.map((game) => (
          <FoundGameTile key={game.id} game={game} onOpen={onOpen} />
        ))}
        {extra > 0 ? (
          <button type="button" className="found-game found-game-more" onClick={onShowAll}>
            <span className="found-game-cover" aria-hidden="true">
              <Icon name="arrow-right" />
            </span>
            <span className="found-game-text">
              <span className="found-game-title">Ещё {extra} в «Играх»</span>
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
