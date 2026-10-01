
import { gridMediaSrc } from "../lib/api";
import { coverStyle } from "../lib/coverFrame";
import type { Game } from "../lib/types";

interface GamePlateProps {
  game: Game | undefined;
  className: string;
}

export function GamePlate({ game, className }: GamePlateProps) {
  const image = game?.image ?? null;
  const cover = image ? gridMediaSrc(["images", image], game?.imageZoom) : null;


  return (
    <span className={`game-plate ${className}${cover ? "" : " letter"}`} data-engine={game?.engine ?? undefined} aria-hidden="true">
      {cover && game ? (
        <img src={cover} alt="" style={coverStyle(game.imageX, game.imageY, game.imageZoom)} />
      ) : (
        game?.title.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}
