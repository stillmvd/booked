import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { positionStyle } from "../lib/coverFrame";
import type { Game } from "../lib/types";

interface GamePlateProps {
  game: Game | undefined;
  className: string;
}

export function GamePlate({ game, className }: GamePlateProps) {
  const [cover, setCover] = useState<string | null>(null);
  const image = game?.image ?? null;

  useEffect(() => {
    let alive = true;
    if (!image) {
      setCover(null);
      return;
    }
    mediaPath(["images", image])
      .then((full) => alive && setCover(convertFileSrc(full)))
      .catch(() => alive && setCover(null));
    return () => {
      alive = false;
    };
  }, [image]);

  return (
    <span className={`game-plate ${className}${cover ? "" : " letter"}`} data-engine={game?.engine ?? undefined} aria-hidden="true">
      {cover && game ? (
        <img src={cover} alt="" style={{ objectPosition: positionStyle(game.imageX, game.imageY) }} />
      ) : (
        game?.title.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}
