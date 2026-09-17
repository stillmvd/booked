import { noteSubline, noteTitle } from "../lib/gameVersions";
import type { Game, GameVersionGroup } from "../lib/types";
import { GamePlate } from "./GamePlate";
import { Icon } from "./Icon";

interface GameVersionsNoteProps {
  group: GameVersionGroup;
  others: number;
  games: ReadonlyMap<number, Game>;
  onCompare: () => void;
}

export function GameVersionsNote({ group, others, games, onCompare }: GameVersionsNoteProps) {
  const { title, versions } = noteTitle(group, games);
  const old = games.get(group.ids[0]);
  const fresh = games.get(group.ids[group.ids.length - 1]);

  return (
    <div className="game-versions-note">
      <span className="game-versions-plates" aria-hidden="true">
        <GamePlate game={old} className="game-versions-plate game-versions-plate-old" />
        <GamePlate game={fresh} className="game-versions-plate game-versions-plate-new" />
      </span>
      <span className="game-versions-note-text">
        <span className="game-versions-note-title">
          {title}
          {versions ? <span className="game-versions-note-numbers"> {versions}</span> : null}
        </span>
        <span className="game-versions-note-sub">{noteSubline(group, others)}</span>
      </span>
      <button type="button" className="game-versions-compare" onClick={onCompare}>
        Сравнить
        <span className="game-versions-compare-mark" aria-hidden="true">
          <Icon name="arrow-right" />
        </span>
      </button>
    </div>
  );
}
