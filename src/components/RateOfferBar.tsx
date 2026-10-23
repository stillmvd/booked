import { useEffect, useState, type KeyboardEvent } from "react";

import { gameSetRating, gameSetTags } from "../lib/api";
import { loadGames } from "../lib/gamesStore";
import { dismissRateAsk, useRateAsks } from "../lib/rateAsk";
import { frequentGameTags, playedText, visibleAsk } from "../lib/rateOffer";
import type { Game } from "../lib/types";
import { Icon } from "./Icon";
import { TagMark } from "./TagMark";

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

export function RateOfferBar({ games }: { games: Game[] }) {
  const shown = visibleAsk(useRateAsks());
  const game = shown ? games.find((g) => g.id === shown.ask.id) : undefined;
  const [draft, setDraft] = useState("");
  const [tags, setLocalTags] = useState<string[]>([]);
  const [offered, setOffered] = useState<string[]>([]);
  const shownId = shown?.ask.id;
  const gameFound = game !== undefined;

  useEffect(() => {
    setDraft("");
    const start = games.find((g) => g.id === shownId)?.tags ?? [];
    setLocalTags(start);
    setOffered(start);
  }, [shownId, gameFound]);

  useEffect(() => {
    if (shownId !== undefined && games.length > 0 && !games.some((g) => g.id === shownId)) dismissRateAsk(shownId);
  }, [shownId, games]);

  if (!shown || !game) return null;

  const frequent = frequentGameTags(games);
  const chips = [...frequent];
  for (const tag of [...offered, ...tags]) if (!chips.includes(tag)) chips.push(tag);
  const has = (tag: string) => tags.some((t) => t.toLowerCase() === tag.toLowerCase());

  function setTags(next: string[]) {
    setLocalTags(next);
    save(gameSetTags(game!.id, next));
  }

  function toggle(tag: string) {
    setTags(has(tag) ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag]);
  }

  function addDraft() {
    const trimmed = draft.trim();
    setDraft("");
    if (!trimmed || has(trimmed)) return;
    const known = games.flatMap((g) => g.tags).find((t) => t.toLowerCase() === trimmed.toLowerCase());
    setTags([...tags, known ?? trimmed]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
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
      <input
        className="rate-offer-field"
        type="text"
        placeholder="Добавить тег"
        aria-label="Добавить тег"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addDraft();
          }
        }}
      />
      {chips.length > 0 ? (
        <div className="rate-offer-tags">
          {chips.map((tag) => (
            <button key={tag} type="button" className="rate-offer-tag" aria-pressed={has(tag)} onClick={() => toggle(tag)}>
              <TagMark name={tag} size="sm" matched={has(tag)} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
