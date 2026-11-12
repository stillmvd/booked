import { useEffect, useState, type KeyboardEvent } from "react";

import { gameSetNote, gameSetRating } from "../lib/api";
import { loadGames } from "../lib/gamesStore";
import { dismissRateAsk, useRateAsks } from "../lib/rateAsk";
import { playedText, visibleAsk } from "../lib/rateOffer";
import type { Game } from "../lib/types";
import { Icon } from "./Icon";

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? "star on" : "star off"}>
      <path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
    </svg>
  );
}

function save(change: Promise<void>) {
  change.then(() => loadGames()).catch(() => {});
}

export function RateOfferBar({ games, onNotMine }: { games: Game[]; onNotMine: (id: number) => void }) {
  const shown = visibleAsk(useRateAsks());
  const game = shown ? games.find((g) => g.id === shown.ask.id) : undefined;
  const shownId = shown?.ask.id;
  const gameFound = game !== undefined;
  const [note, setNote] = useState("");

  useEffect(() => {
    setNote(games.find((g) => g.id === shownId)?.note ?? "");
  }, [shownId, gameFound]);

  useEffect(() => {
    if (shownId !== undefined && games.length > 0 && !games.some((g) => g.id === shownId)) dismissRateAsk(shownId);
  }, [shownId, games]);

  if (!shown || !game) return null;

  function saveNote() {
    const next = note.trim();
    setNote(next);
    if (next !== game!.note) save(gameSetNote(game!.id, next));
  }

  function notMine() {
    onNotMine(game!.id);
    dismissRateAsk(game!.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      saveNote();
      dismissRateAsk(game!.id);
    }
  }

  return (
    <section className="rate-offer" aria-label={`Оценка игры ${game.title}`} onKeyDown={handleKeyDown}>
      <div className="rate-offer-head">
        <div className="rate-offer-col">
          <span className="rate-offer-name">{game.title}</span>
          <span className="rate-offer-sub">
            {playedText((shown.ask.endedAt ?? Date.now()) - shown.ask.startedAt)}
            {shown.more > 0 ? <span className="rate-offer-more">ещё {shown.more}</span> : null}
          </span>
        </div>
        <button type="button" className="rate-offer-x" aria-label="Закрыть" onClick={() => dismissRateAsk(game.id)}>
          <Icon name="close" />
        </button>
      </div>
      <div className="rate-offer-row">
        <div className="rate-offer-stars" role="group" aria-label="Оценка">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className="rate-offer-star"
              aria-label={`${value} из 5`}
              aria-pressed={game.rating === value}
              onClick={() => save(gameSetRating(game.id, game.rating === value ? 0 : value))}
            >
              <Star filled={value <= game.rating} />
            </button>
          ))}
        </div>
        <button type="button" className="rate-offer-notmine" onClick={notMine}>
          Не моё
        </button>
      </div>
      <input
        className="rate-offer-field"
        type="text"
        placeholder="Пара слов об игре"
        aria-label="Пара слов об игре"
        maxLength={500}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={saveNote}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            saveNote();
          }
        }}
      />
    </section>
  );
}
