import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import {
  gameSetRating,
  gameSetStatus,
  gamesLibrary,
  gamesMeasure,
  gamesRescan,
  gamesRootSet,
} from "../lib/api";
import type { Game, GameStatus } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { GameCard } from "./GameCard";
import { Icon } from "./Icon";

const GAMES_CHANGED_EVENT = "games:changed";

const STATUS_FILTERS: Array<{ value: GameStatus | "all"; label: string }> = [
  { value: "all", label: "Все" },
  { value: "new", label: "Не начата" },
  { value: "playing", label: "Прохожу" },
  { value: "finished", label: "Пройдена" },
  { value: "dropped", label: "Брошена" },
];

interface GamesPageProps {
  sidebar: ReactNode;
}

export function GamesPage({ sidebar }: GamesPageProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [rootAvailable, setRootAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"installed" | "played">("installed");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<GameStatus | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function apply(library: { root: string | null; rootAvailable: boolean; games: Game[] }) {
    setRoot(library.root);
    setRootAvailable(library.rootAvailable);
    setGames(library.games);
    measureMissing(library.games);
  }

  async function measureMissing(list: Game[]) {
    const pending = list.filter((g) => g.folderPath !== null && g.sizeBytes === null);
    for (const game of pending) {
      try {
        const size = await gamesMeasure(game.id);
        if (size !== null) patch(game.id, { sizeBytes: size });
      } catch {
        return;
      }
    }
  }

  useEffect(() => {
    let alive = true;
    function load() {
      gamesLibrary()
        .then((library) => alive && apply(library))
        .catch((err) => alive && setError(userMessage(err)));
    }
    load();
    const unlisten = listen(GAMES_CHANGED_EVENT, load);
    return () => {
      alive = false;
      unlisten.then((off) => off());
    };
  }, []);

  async function pickRoot() {
    const picked = await open({ directory: true, multiple: false });
    if (!picked || Array.isArray(picked)) return;
    setBusy(true);
    setError(null);
    try {
      apply(await gamesRootSet(picked));
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const library = await gamesRescan();
      apply({ ...library, games: library.games.map((game) => ({ ...game, sizeBytes: null })) });
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function patch(id: number, change: Partial<Game>) {
    setGames((list) => list.map((game) => (game.id === id ? { ...game, ...change } : game)));
  }

  function handleRate(id: number, rating: number) {
    patch(id, { rating });
    gameSetRating(id, rating).catch((err) => setError(userMessage(err)));
  }

  function handleStatus(id: number, next: GameStatus) {
    patch(id, { status: next });
    gameSetStatus(id, next).catch((err) => setError(userMessage(err)));
  }

  const tags = useMemo(() => {
    const all = new Set<string>();
    games.forEach((game) => game.tags.forEach((t) => all.add(t)));
    return Array.from(all).sort((a, b) => a.localeCompare(b, "ru"));
  }, [games]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return games.filter((game) => {
      if (tab === "installed" ? game.folderPath === null : game.folderPath !== null) return false;
      if (status !== "all" && game.status !== status) return false;
      if (tag && !game.tags.includes(tag)) return false;
      if (needle && !game.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [games, tab, status, tag, query]);

  const installedCount = games.filter((g) => g.folderPath !== null).length;
  const playedCount = games.length - installedCount;
  const current = shown.find((g) => g.id === selected) ?? null;

  return (
    <div className="split">
      {sidebar}
      <div className="main">
        <div className="app-head">
          <div className="app-head-row">
            <div className="folder-title">
              <h1>Игры</h1>
              <span>
                {root
                  ? rootAvailable
                    ? `${installedCount} на диске · ${playedCount} сыграно`
                    : "Папка сейчас недоступна"
                  : "Папка не выбрана"}
              </span>
            </div>
            <div className="acts">
              <button type="button" className="btn-primary" onClick={refresh} disabled={busy || !root}>
                <Icon name="reset" />
                Обновить список
              </button>
            </div>
          </div>

          {root && !rootAvailable ? (
            <p className="games-warning">Папка {root} сейчас недоступна — карточки сохранены.</p>
          ) : null}
          {error ? <p className="games-warning">{error}</p> : null}

          {root ? (
            <div className="games-filters">
              <div className="games-tabs" role="tablist" aria-label="Показывать игры">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "installed"}
                  className={tab === "installed" ? "active" : ""}
                  onClick={() => setTab("installed")}
                >
                  Установленные <span className="games-count">{installedCount}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "played"}
                  className={tab === "played" ? "active" : ""}
                  onClick={() => setTab("played")}
                >
                  Сыграно <span className="games-count">{playedCount}</span>
                </button>
              </div>

              <input
                type="search"
                className="games-search"
                value={query}
                placeholder="Найти игру"
                aria-label="Найти игру по названию"
                onChange={(e) => setQuery(e.target.value)}
              />

              <div className="games-status-filter" role="group" aria-label="Фильтр по статусу">
                {STATUS_FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={status === item.value}
                    className={status === item.value ? "active" : ""}
                    onClick={() => setStatus(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {root && tags.length > 0 ? (
            <div className="games-tag-bar">
              {tags.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={tag === name}
                  className={tag === name ? "active" : ""}
                  onClick={() => setTag(tag === name ? null : name)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="games-body">
          {!root ? (
            <div className="games-empty">
              <p>Укажите папку, где лежат игры.</p>
              <button type="button" className="btn-primary" onClick={pickRoot} disabled={busy}>
                Выбрать папку
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="games-empty">
              <p>
                {tab === "installed"
                  ? "Здесь пока пусто. Перенесите папку с игрой в выбранную папку — карточка появится сама."
                  : "Сюда попадают игры, которых больше нет на диске."}
              </p>
            </div>
          ) : (
            <div className="games-grid">
              {shown.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  selected={selected === game.id}
                  onSelect={(id) => setSelected(selected === id ? null : id)}
                  onRate={handleRate}
                />
              ))}
            </div>
          )}
        </div>

        {current ? (
          <div className="games-statusbar">
            <span className="games-statusbar-title">{current.title}</span>
            <div className="games-status-filter" role="group" aria-label="Статус игры">
              {STATUS_FILTERS.filter((s) => s.value !== "all").map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={current.status === item.value}
                  className={current.status === item.value ? "active" : ""}
                  onClick={() => handleStatus(current.id, item.value as GameStatus)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
