import { useEffect, useState } from "react";

import { updateLabel } from "../lib/gameFormat";
import type { Game } from "../lib/types";

interface GamePageRowProps {
  game: Game;
  busy: boolean;
  onSave: (url: string | null) => void;
  onOpen: () => void;
  onSkip: () => void;
}

export function GamePageRow({ game, busy, onSave, onOpen, onSkip }: GamePageRowProps) {
  const [value, setValue] = useState(game.pageUrl ?? "");

  useEffect(() => {
    setValue(game.pageUrl ?? "");
  }, [game.id, game.pageUrl]);

  function save() {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === game.pageUrl) return;
    onSave(next);
  }

  const badge = game.hasUpdate ? updateLabel(game.source, game.siteVersion, game.versionInstalled) : "";
  const untracked = game.pageUrl !== null && game.source === null;
  const openable = /^https?:\/\/\S/i.test(game.pageUrl ?? "");

  return (
    <div className="games-pagerow">
      <label className="games-page-field">
        <span>Страница игры</span>
        <input
          type="url"
          value={value}
          placeholder="https://f95zone.to/threads/…"
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setValue(game.pageUrl ?? "");
          }}
        />
      </label>

      {openable ? (
        <button type="button" onClick={onOpen} disabled={busy}>
          Открыть страницу
        </button>
      ) : null}

      {game.hasUpdate ? (
        <button type="button" onClick={onSkip} disabled={busy}>
          Пропустить эту версию
        </button>
      ) : null}

      {badge ? <span className="games-page-badge">{badge}</span> : null}
      {untracked ? (
        <span className="games-acts-note">Отслеживание работает только для F95zone и itch.io</span>
      ) : null}
    </div>
  );
}
