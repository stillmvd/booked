import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";

import { updateLabel } from "../lib/gameFormat";
import type { Game, GameStatus } from "../lib/types";
import { SplitName } from "./Highlighted";
import { Icon } from "./Icon";

const STATUSES: Array<{ value: GameStatus; label: string }> = [
  { value: "new", label: "Не начата" },
  { value: "playing", label: "Прохожу" },
  { value: "finished", label: "Пройдена" },
  { value: "dropped", label: "Брошена" },
];

interface GamePanelProps {
  game: Game;
  busy: boolean;
  style?: CSSProperties;
  onStatus: (status: GameStatus) => void;
  onSave: (url: string | null) => void;
  onOpen: () => void;
  onSkip: () => void;
  onClose: () => void;
}

export function GamePanel({ game, busy, style, onStatus, onSave, onOpen, onSkip, onClose }: GamePanelProps) {
  const [value, setValue] = useState(game.pageUrl ?? "");
  const baseId = useId();

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
    <section className="game-panel" style={style} data-morph="panel" aria-labelledby={`${baseId}-title`}>
      <div className="game-panel-head">
        <h2 className="game-panel-title" id={`${baseId}-title`}>
          <SplitName text={game.title} />
        </h2>
        <button type="button" className="game-panel-close" aria-label="Закрыть панель игры" title="Закрыть" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {badge ? <p className="game-panel-update">{badge}</p> : null}

      <div className="game-panel-statuses" role="group" aria-label="Статус игры">
        {STATUSES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={game.status === item.value}
            onClick={() => onStatus(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="game-panel-page">
        <label className="game-panel-label" htmlFor={`${baseId}-page`}>
          Страница игры
        </label>
        <div className="game-panel-field">
          <input
            id={`${baseId}-page`}
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
          {openable ? (
            <button
              type="button"
              className="game-panel-open"
              aria-label="Открыть страницу"
              title="Открыть страницу"
              disabled={busy}
              onClick={onOpen}
            >
              <Icon name="arrow-up-right" />
            </button>
          ) : null}
        </div>
        {untracked ? <p className="game-panel-note">Отслеживание работает только для F95zone и itch.io</p> : null}
      </div>

      {game.hasUpdate ? (
        <button type="button" className="game-panel-skip" disabled={busy} onClick={onSkip}>
          Пропустить эту версию
        </button>
      ) : null}
    </section>
  );
}
