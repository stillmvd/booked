import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import {
  gameDeleteFolder,
  gameExeList,
  gameForget,
  gameLaunch,
  gameOpenPage,
  gameSetExe,
  gameSetPage,
  gameSetRating,
  gameSetStatus,
  gameSkipVersion,
  gamesCheck,
  gamesLibrary,
  gamesMeasure,
  gamesRescan,
  gamesRootSet,
} from "../lib/api";
import { buildGameMenu } from "../lib/menuItems";
import type { Rect } from "../lib/menuPosition";
import type { Bookmark, Game, GameStatus } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { ContextMenu } from "./ContextMenu";
import { GameCard } from "./GameCard";
import { HitRow } from "./HitRow";
import { GameDeleteDialog } from "./GameDeleteDialog";
import type { GameDeleteMode } from "./GameDeleteDialog";
import { GameExeDialog } from "./GameExeDialog";
import { GameForm } from "./GameForm";
import { GamePageRow } from "./GamePageRow";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

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
  query: string;
  bookmarkHits: Bookmark[];
  highlightId: number | null;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onGoToBookmarks: () => void;
}

export function GamesPage({
  sidebar,
  query,
  bookmarkHits,
  highlightId,
  onOpenBookmark,
  onGoToBookmarks,
}: GamesPageProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [rootAvailable, setRootAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"installed" | "played">("installed");
  const [status, setStatus] = useState<GameStatus | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ id: number; anchor: Rect } | null>(null);
  const [dialog, setDialog] = useState<{ id: number; kind: GameDeleteMode | "exe" | "edit" } | null>(null);
  const busyRef = useRef(false);

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
    await guarded(async () => apply(await gamesRootSet(picked)));
  }

  function refresh() {
    return guarded(async () => {
      const library = await gamesRescan();
      apply({ ...library, games: library.games.map((game) => ({ ...game, sizeBytes: null })) });
    });
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

  async function guarded(run: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleLaunch(id: number) {
    const game = games.find((g) => g.id === id) ?? null;
    return guarded(async () => {
      try {
        await gameLaunch(id);
      } catch (err) {
        setError(userMessage(err));
        const list = await gameExeList(id).catch(() => [] as string[]);
        const known = game?.exePath ? list.includes(game.exePath) : false;
        if (list.length > 0 && !known) setDialog({ id, kind: "exe" });
        return;
      }
      apply(await gamesLibrary());
    });
  }

  function handlePickExe(id: number, path: string) {
    setDialog(null);
    return guarded(async () => {
      await gameSetExe(id, path);
      patch(id, { exePath: path, exeSource: "manual" });
    });
  }

  function confirmDeleteFolder(id: number) {
    setDialog(null);
    return guarded(() => gameDeleteFolder(id));
  }

  function confirmForget(id: number) {
    setDialog(null);
    return guarded(async () => {
      await gameForget(id);
      setGames((list) => list.filter((game) => game.id !== id));
      setSelected((current) => (current === id ? null : current));
    });
  }

  function handleSetPage(id: number, url: string | null) {
    return guarded(async () => {
      try {
        await gameSetPage(id, url);
      } finally {
        apply(await gamesLibrary());
      }
    });
  }

  function handleSkipVersion(id: number) {
    return guarded(async () => {
      await gameSkipVersion(id);
      apply(await gamesLibrary());
    });
  }

  function checkNow() {
    return guarded(async () => apply(await gamesCheck(true)));
  }

  function handleOpenPage(id: number) {
    gameOpenPage(id).catch((err) => setError(userMessage(err)));
  }

  function openMenu(id: number, anchor: Rect) {
    setSelected(id);
    setMenu({ id, anchor });
  }

  useEffect(() => {
    if (highlightId !== null && games.some((game) => game.id === highlightId)) setSelected(highlightId);
  }, [highlightId, games]);

  useEffect(() => {
    if (dialog && !games.some((game) => game.id === dialog.id)) setDialog(null);
    if (menu && !games.some((game) => game.id === menu.id)) setMenu(null);
  }, [games, dialog, menu]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (document.querySelector(".modal-backdrop")) return;

      if (e.key === "Escape") {
        if (menu) {
          setMenu(null);
          return;
        }
        if (selected === null) return;
        setSelected(null);
        const card = document.querySelector<HTMLElement>(".game-card-open:focus");
        card?.blur();
        return;
      }

      if (e.key !== "F2" || selected === null) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      setDialog({ id: selected, kind: "edit" });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selected, menu]);

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

  const searching = query.trim() !== "";
  const installedCount = games.filter((g) => g.folderPath !== null).length;
  const playedCount = games.length - installedCount;
  const current = shown.find((g) => g.id === selected) ?? null;
  const menuGame = menu === null ? null : (games.find((g) => g.id === menu.id) ?? null);
  const dialogGame = dialog === null ? null : (games.find((g) => g.id === dialog.id) ?? null);

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
              <button type="button" onClick={checkNow} disabled={busy || !root}>
                Проверить обновления
              </button>
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
                {searching
                  ? "Среди игр ничего не нашлось."
                  : tab === "installed"
                    ? "Здесь пока пусто. Перенесите папку с игрой в выбранную папку — карточка появится сама."
                    : "Сюда попадают игры, которых больше нет на диске."}
              </p>
            </div>
          ) : (
            <>
              {searching ? (
                <h2 className="hit-group-head">
                  Игры <span className="hit-group-count">{shown.length}</span>
                </h2>
              ) : null}
              <div className="games-grid">
                {shown.map((game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    selected={selected === game.id}
                    onSelect={setSelected}
                    onRate={handleRate}
                    onMenu={openMenu}
                    onLaunch={handleLaunch}
                  />
                ))}
              </div>
            </>
          )}

          {searching && bookmarkHits.length > 0 ? (
            <section className="hit-group" aria-label="Найденные закладки">
              <h2 className="hit-group-head">
                Закладки <span className="hit-group-count">{bookmarkHits.length}</span>
                <button type="button" className="hit-group-more" onClick={onGoToBookmarks}>
                  Показать все
                </button>
              </h2>
              <div className="hit-list">
                {bookmarkHits.slice(0, 8).map((bookmark) => (
                  <HitRow
                    key={bookmark.id}
                    icon="bookmark"
                    title={bookmark.title}
                    note={bookmark.url}
                    onOpen={() => onOpenBookmark(bookmark)}
                  />
                ))}
              </div>
            </section>
          ) : null}
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

            <div className="games-acts">
              <button
                type="button"
                onClick={() => setDialog({ id: current.id, kind: "edit" })}
                disabled={busy}
              >
                Изменить…
              </button>
              {current.folderPath === null ? null : (
                <button
                  type="button"
                  onClick={() => setDialog({ id: current.id, kind: "exe" })}
                  disabled={busy}
                >
                  Чем запускать…
                </button>
              )}

              <span className="acts-sep" aria-hidden="true" />

              {current.folderPath === null ? null : (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setDialog({ id: current.id, kind: "folder" })}
                  disabled={busy}
                >
                  Удалить с диска
                </button>
              )}
              <button
                type="button"
                onClick={() => setDialog({ id: current.id, kind: "forget" })}
                disabled={busy}
              >
                Убрать из списка
              </button>
            </div>

            <GamePageRow
              game={current}
              busy={busy}
              onSave={(url) => handleSetPage(current.id, url)}
              onOpen={() => handleOpenPage(current.id)}
              onSkip={() => handleSkipVersion(current.id)}
            />
          </div>
        ) : null}
      </div>

      {menu && menuGame ? (
        <ContextMenu
          groups={buildGameMenu({
            installed: menuGame.folderPath !== null,
            onLaunch: () => handleLaunch(menuGame.id),
            onPickExe: () => setDialog({ id: menuGame.id, kind: "exe" }),
            onEdit: () => setDialog({ id: menuGame.id, kind: "edit" }),
            onDeleteFolder: () => setDialog({ id: menuGame.id, kind: "folder" }),
            onForget: () => setDialog({ id: menuGame.id, kind: "forget" }),
          })}
          anchor={menu.anchor}
          ariaLabel={`Меню игры ${menuGame.title}`}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {dialog && dialogGame ? (
        <Modal onClose={() => setDialog(null)} titleId="game-dialog-title">
          {dialog.kind === "edit" ? (
            <GameForm
              game={dialogGame}
              suggestions={tags}
              titleId="game-dialog-title"
              onClose={() => setDialog(null)}
              onSaved={() => {
                setDialog(null);
                gamesLibrary()
                  .then(apply)
                  .catch((err) => setError(userMessage(err)));
              }}
            />
          ) : dialog.kind === "exe" ? (
            <GameExeDialog
              game={dialogGame}
              titleId="game-dialog-title"
              onClose={() => setDialog(null)}
              onPick={(path) => handlePickExe(dialogGame.id, path)}
            />
          ) : (
            <GameDeleteDialog
              game={dialogGame}
              mode={dialog.kind}
              titleId="game-dialog-title"
              onClose={() => setDialog(null)}
              onConfirm={() =>
                dialog.kind === "folder" ? confirmDeleteFolder(dialogGame.id) : confirmForget(dialogGame.id)
              }
            />
          )}
        </Modal>
      ) : null}
    </div>
  );
}
