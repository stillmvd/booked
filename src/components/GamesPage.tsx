import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import {
  gameDeleteFolder,
  gameExeList,
  gameForget,
  gameLaunch,
  gameMarkDistinct,
  gameMergeApply,
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
import { gridColumns, openPlacement } from "../lib/gameGrid";
import { newestIds, openGroups, toastText } from "../lib/gameVersions";
import { morphLayout } from "../lib/gridMorph";
import { cancel, pendingKeys, schedule } from "../lib/pendingDeletions";
import { buildGameMenu } from "../lib/menuItems";
import type { Rect } from "../lib/menuPosition";
import { prefersReducedMotion } from "../lib/motion";
import { hostOf } from "../lib/plate";
import { pluralizeRu } from "../lib/pluralizeRu";
import type { Bookmark, Game, GameStatus, GameVersionGroup, TagCount } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { ContextMenu } from "./ContextMenu";
import { GameCard } from "./GameCard";
import { GameDeleteDialog } from "./GameDeleteDialog";
import type { GameDeleteMode } from "./GameDeleteDialog";
import { GameExeDialog } from "./GameExeDialog";
import { GameForm } from "./GameForm";
import { GameMergeDialog } from "./GameMergeDialog";
import type { GameMergeChoice } from "./GameMergeDialog";
import { GameMergePermanentDialog } from "./GameMergePermanentDialog";
import { GameMergeToast } from "./GameMergeToast";
import { GamePanel } from "./GamePanel";
import { GamesEmpty } from "./GamesEmpty";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { ShowcaseNote } from "./ShowcaseNote";
import { TagFilterBar } from "./TagFilterBar";
import { GameVersionPick } from "./GameVersionPick";
import { GameVersionsNote } from "./GameVersionsNote";

const GAMES_CHANGED_EVENT = "games:changed";
const REVEAL_PAD = 16;
const MERGE_DELAY_MS = 8000;
const MERGE_HOLD_MS = 2_147_483_647;

const STATUS_FILTERS: Array<{ value: GameStatus | "all"; label: string }> = [
  { value: "all", label: "Все" },
  { value: "new", label: "Не начата" },
  { value: "playing", label: "Прохожу" },
  { value: "finished", label: "Пройдена" },
  { value: "dropped", label: "Брошена" },
];

type GamesLibraryState = { root: string | null; rootAvailable: boolean; games: Game[]; versions: GameVersionGroup[] };

interface PendingMerge {
  key: string;
  ids: number[];
  keptId: number;
  text: string;
  startedAt: number;
  running?: boolean;
}

interface PermanentAsk extends PendingMerge {
  folder: string;
  path: string;
  bytes: number;
}

let libraryCache: GamesLibraryState | null = null;

interface MergeQueue {
  entries: PendingMerge[];
  permanent: PermanentAsk | null;
  error: string | null;
}

let mergeQueue: MergeQueue = { entries: [], permanent: null, error: null };
const mergeListeners = new Set<() => void>();
let reloadGames: (() => Promise<void>) | null = null;

function updateMerges(change: (queue: MergeQueue) => Partial<MergeQueue>) {
  mergeQueue = { ...mergeQueue, ...change(mergeQueue) };
  mergeListeners.forEach((listener) => listener());
}

function subscribeMerges(listener: () => void) {
  mergeListeners.add(listener);
  return () => {
    mergeListeners.delete(listener);
  };
}

async function runMerge(entry: PendingMerge, permanentPath: string | null) {
  const { key, ids, keptId, text, startedAt } = entry;
  const running: PendingMerge = { key, ids, keptId, text, startedAt, running: true };
  updateMerges(({ entries }) => ({ entries: [...entries.filter((item) => item.key !== key), running] }));
  try {
    const outcome = await gameMergeApply(ids, keptId, permanentPath);
    if (outcome.kind === "needsPermanent") {
      updateMerges(() => ({
        permanent: { ...running, running: false, folder: outcome.folder, path: outcome.path, bytes: outcome.bytes },
      }));
    }
  } catch (err) {
    updateMerges(() => ({ error: userMessage(err) }));
  }
  await reloadGames?.();
  updateMerges(({ entries }) => ({ entries: entries.filter((item) => item.key !== key) }));
}

function scheduleMerge(entry: PendingMerge, delayMs: number) {
  schedule(entry.key, () => runMerge(entry, null), delayMs);
}

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
  const [games, setGames] = useState<Game[]>(() => libraryCache?.games ?? []);
  const [versions, setVersions] = useState<GameVersionGroup[]>(() => libraryCache?.versions ?? []);
  const [mergeIds, setMergeIds] = useState<number[] | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const merges = useSyncExternalStore(subscribeMerges, () => mergeQueue);
  const pendingMerges = merges.entries;
  const permanent = merges.permanent;
  const [mergeBusy, setMergeBusy] = useState(false);
  const [root, setRoot] = useState<string | null>(() => libraryCache?.root ?? null);
  const [rootAvailable, setRootAvailable] = useState(() => libraryCache?.rootAvailable ?? true);
  const [loaded, setLoaded] = useState(() => libraryCache !== null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<GameStatus | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [columns, setColumns] = useState(1);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ id: number; anchor: Rect } | null>(null);
  const [dialog, setDialog] = useState<{ id: number; kind: GameDeleteMode | "exe" | "edit" } | null>(null);
  const busyRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gridObserver = useRef<ResizeObserver | null>(null);

  const gridRef = useCallback((grid: HTMLDivElement | null) => {
    gridObserver.current?.disconnect();
    gridObserver.current = null;
    if (!grid) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setColumns(gridColumns(entry.contentRect.width));
    });
    observer.observe(grid);
    gridObserver.current = observer;
  }, []);

  function apply(library: GamesLibraryState) {
    setRoot(library.root);
    setRootAvailable(library.rootAvailable);
    setGames(library.games);
    setVersions(library.versions ?? []);
    setLoaded(true);
    measureMissing(library.games);
  }

  useEffect(() => {
    if (loaded) libraryCache = { root, rootAvailable, games, versions };
  }, [loaded, root, rootAvailable, games, versions]);

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
        .catch((err) => {
          if (!alive) return;
          setError(userMessage(err));
          setLoaded(true);
        });
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
    if (busyRef.current) return Promise.resolve();
    setScanning(true);
    return guarded(async () => {
      const library = await gamesRescan();
      apply({ ...library, games: library.games.map((game) => ({ ...game, sizeBytes: null })) });
    }).finally(() => setScanning(false));
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
      apply(await gamesLibrary());
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
      setOpenId((current) => (current === id ? null : current));
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

  function reloadLibrary() {
    return gamesLibrary()
      .then(apply)
      .catch((err) => setError(userMessage(err)));
  }

  useEffect(() => {
    reloadGames = reloadLibrary;
  });

  useEffect(
    () => () => {
      reloadGames = null;
    },
    [],
  );

  useEffect(() => {
    if (merges.error === null) return;
    setError(merges.error);
    updateMerges(() => ({ error: null }));
  }, [merges.error]);

  function startMerge({ ids, keptId }: GameMergeChoice) {
    setMergeIds(null);
    const key = `game-merge:${ids.join(",")}`;
    if (mergeQueue.entries.some((item) => item.key === key)) return;
    if (mergeQueue.entries.some((item) => item.ids.some((id) => ids.includes(id)))) {
      setError("Одна из этих карточек уже объединяется — дождитесь конца или нажмите «Отменить».");
      return;
    }
    const survivor = games.find((game) => game.id === ids[0]);
    const kept = games.find((game) => game.id === keptId);
    const entry: PendingMerge = { key, ids, keptId, text: toastText(survivor, kept), startedAt: Date.now() };
    setError(null);
    updateMerges(({ entries }) => ({ entries: [...entries, entry] }));
    scheduleMerge(entry, MERGE_DELAY_MS);
  }

  function holdMerge(entry: PendingMerge, held: boolean) {
    if (!pendingKeys().has(entry.key)) return;
    if (held) {
      scheduleMerge(entry, MERGE_HOLD_MS);
      return;
    }
    const next = { ...entry, startedAt: Date.now() };
    updateMerges(({ entries }) => ({ entries: entries.map((item) => (item.key === entry.key ? next : item)) }));
    scheduleMerge(next, MERGE_DELAY_MS);
  }

  function undoMerge(entry: PendingMerge) {
    cancel(entry.key);
    updateMerges(({ entries }) => ({ entries: entries.filter((item) => item.key !== entry.key) }));
  }

  function markDistinct(ids: number[]) {
    setMergeIds(null);
    gameMarkDistinct(ids)
      .then(reloadLibrary)
      .catch((err) => setError(userMessage(err)));
  }

  async function confirmPermanent(ask: PermanentAsk) {
    setMergeBusy(true);
    updateMerges(() => ({ permanent: null }));
    try {
      await runMerge(ask, ask.path);
    } finally {
      setMergeBusy(false);
    }
  }

  function openVersions(id: number) {
    const group = badgeGroups.current.get(id);
    if (group) setMergeIds(group.ids);
  }

  function openMenu(id: number, anchor: Rect) {
    setSelected(id);
    setMenu({ id, anchor });
  }

  function morph(ids: Array<number | null>, update: () => void) {
    const body = bodyRef.current;
    const commit = () => flushSync(update);
    if (!body || prefersReducedMotion()) {
      commit();
      return;
    }
    const keys = ids.filter((id): id is number => id !== null).map((id) => `card-${id}`);
    morphLayout(body, [...keys, "panel", "spot"], commit);
  }

  function revealPanel() {
    const body = bodyRef.current;
    const panel = body?.querySelector(".game-panel");
    if (!body || !panel) return;
    const view = body.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const above = box.top - view.top - REVEAL_PAD;
    const below = box.bottom - view.bottom + REVEAL_PAD;
    const top = above < 0 ? above : below > 0 ? Math.min(below, above) : 0;
    if (top !== 0) body.scrollBy({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function toggleOpen(id: number) {
    const next = openId === id ? null : id;
    morph([openId, next], () => {
      setSelected(id);
      setOpenId(next);
    });
    if (next !== null) revealPanel();
  }

  function closePanel() {
    morph([openId], () => setOpenId(null));
  }

  const badgeGroups = useRef(new Map<number, GameVersionGroup>());
  const cardActions = useRef({ toggleOpen, handleRate, openMenu, handleLaunch, handleOpenPage, openVersions });
  cardActions.current = { toggleOpen, handleRate, openMenu, handleLaunch, handleOpenPage, openVersions };
  const onCardSelect = useCallback((id: number) => cardActions.current.toggleOpen(id), []);
  const onCardRate = useCallback((id: number, rating: number) => cardActions.current.handleRate(id, rating), []);
  const onCardMenu = useCallback((id: number, anchor: Rect) => cardActions.current.openMenu(id, anchor), []);
  const onCardLaunch = useCallback((id: number) => cardActions.current.handleLaunch(id), []);
  const onCardOpenPage = useCallback((id: number) => cardActions.current.handleOpenPage(id), []);
  const onCardVersions = useCallback((id: number) => cardActions.current.openVersions(id), []);

  useEffect(() => {
    if (highlightId === null || !games.some((game) => game.id === highlightId)) return;
    setSelected(highlightId);
    setOpenId(highlightId);
  }, [highlightId, games]);

  useEffect(() => {
    if (dialog && !games.some((game) => game.id === dialog.id)) setDialog(null);
    if (menu && !games.some((game) => game.id === menu.id)) setMenu(null);
    if (mergeIds && !mergeIds.every((id) => games.some((game) => game.id === id))) setMergeIds(null);
    if (pickFor !== null && !games.some((game) => game.id === pickFor)) setPickFor(null);
  }, [games, dialog, menu, mergeIds, pickFor]);

  const pendingIds = useMemo(() => new Set(pendingMerges.flatMap((item) => item.ids)), [pendingMerges]);

  const visibleGames = useMemo(() => {
    if (pendingMerges.length === 0) return games;
    const byId = new Map(games.map((game) => [game.id, game]));
    const hidden = new Set<number>();
    const patches = new Map<number, Partial<Game>>();
    for (const item of pendingMerges) {
      item.ids.slice(1).forEach((id) => hidden.add(id));
      const kept = byId.get(item.keptId);
      if (kept && item.keptId !== item.ids[0]) {
        patches.set(item.ids[0], {
          folderPath: kept.folderPath,
          folderName: kept.folderName,
          versionInstalled: kept.versionInstalled,
          sizeBytes: kept.sizeBytes,
          exePath: kept.exePath,
        });
      }
    }
    return games
      .filter((game) => !hidden.has(game.id))
      .map((game) => (patches.has(game.id) ? { ...game, ...patches.get(game.id) } : game));
  }, [games, pendingMerges]);

  const gamesById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const groups = useMemo(
    () => openGroups(versions, pendingIds, new Set(games.map((game) => game.id))),
    [versions, pendingIds, games],
  );
  const badges = useMemo(() => newestIds(groups), [groups]);
  badgeGroups.current = badges;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (document.querySelector(".modal-backdrop")) return;
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;

      if (e.key === "Escape") {
        if (menu) {
          setMenu(null);
          return;
        }
        if (typing) return;
        if (openId !== null) {
          morph([openId], () => {
            setOpenId(null);
            setSelected(null);
          });
          return;
        }
        if (selected === null) return;
        setSelected(null);
        const card = document.querySelector<HTMLElement>(".game-card-open:focus");
        card?.blur();
        return;
      }

      if (e.key === "F5") {
        e.preventDefault();
        if (root) refresh();
        return;
      }

      if (e.key !== "F2" || selected === null || typing) return;
      e.preventDefault();
      setDialog({ id: selected, kind: "edit" });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selected, openId, menu, root]);

  const tags = useMemo(() => {
    const all = new Set<string>();
    visibleGames.forEach((game) => game.tags.forEach((t) => all.add(t)));
    return Array.from(all).sort((a, b) => a.localeCompare(b, "ru"));
  }, [visibleGames]);

  const tagCounts = useMemo<TagCount[]>(() => {
    const counts = new Map<string, number>();
    visibleGames.forEach((game) => game.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return Array.from(counts, ([name, count]) => ({ name, count })).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"),
    );
  }, [visibleGames]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visibleGames.filter((game) => {
      if (status !== "all" && game.status !== status) return false;
      if (tag && !game.tags.includes(tag)) return false;
      if (needle && !game.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [visibleGames, status, tag, query]);

  const openIndex = openId === null ? -1 : shown.findIndex((game) => game.id === openId);

  useEffect(() => {
    if (openId !== null && openIndex < 0) setOpenId(null);
  }, [openId, openIndex]);

  const searching = query.trim() !== "";
  const statusLabel = STATUS_FILTERS.find((item) => item.value === status)?.label ?? "";
  const countNote = !root
    ? "Папка не выбрана"
    : pluralizeRu(shown.length, ["игра", "игры", "игр"]) + (scanning ? " · смотрю, что в папке…" : "");
  const placement = openPlacement(openIndex, columns, shown.length);
  const openGame = openIndex < 0 ? null : shown[openIndex];
  const menuGame = menu === null ? null : (games.find((g) => g.id === menu.id) ?? null);
  const dialogGame = dialog === null ? null : (games.find((g) => g.id === dialog.id) ?? null);
  const waitingMerges = pendingMerges.filter((entry) => !entry.running);
  const toastStack = waitingMerges.length > 0 ? document.querySelector(".delete-toast-stack") : null;

  function nothingText() {
    const needle = query.trim();
    const filters = [
      status !== "all" ? `со статусом «${statusLabel}»` : "",
      tag ? `с тегом «${tag}»` : "",
    ]
      .filter(Boolean)
      .join(" и ");
    if (needle) return filters ? `Среди игр ${filters} нет «${needle}».` : `Среди игр нет «${needle}».`;
    return `Нет игр ${filters}.`;
  }

  const filtered = status !== "all" || tag !== null;

  const emptyNode =
    games.length === 0 ? (
      <GamesEmpty
        icon="gamepad"
        title="Здесь пока пусто"
        text={`Перенесите папку с игрой в ${root} — карточка появится сама.`}
      />
    ) : (
      <GamesEmpty
        icon="search"
        title="Ничего не нашлось"
        text={nothingText()}
        action={
          filtered
            ? {
                label: "Сбросить фильтры",
                onClick: () => {
                  setStatus("all");
                  setTag(null);
                },
              }
            : undefined
        }
      />
    );

  const gridNode = (
    <div className="games-grid" ref={gridRef}>
      {shown.map((game) => {
        const isOpen = game.id === openId;
        return (
          <Fragment key={game.id}>
            {isOpen && placement.spot ? <div key="spot" className="game-spot" style={placement.spot} data-morph="spot" aria-hidden="true" /> : null}
            <GameCard
              key="card"
              game={game}
              selected={selected === game.id}
              open={isOpen}
              style={isOpen ? (placement.card ?? undefined) : undefined}
              onSelect={onCardSelect}
              onRate={onCardRate}
              onMenu={onCardMenu}
              onLaunch={onCardLaunch}
              onOpenPage={onCardOpenPage}
              newVersion={badges.has(game.id)}
              onVersions={onCardVersions}
            />
            {isOpen && openGame ? (
              <GamePanel
                key="panel"
                game={openGame}
                busy={busy}
                style={placement.panel ?? undefined}
                onStatus={(next) => handleStatus(openGame.id, next)}
                onSave={(url) => handleSetPage(openGame.id, url)}
                onOpen={() => handleOpenPage(openGame.id)}
                onSkip={() => handleSkipVersion(openGame.id)}
                onClose={closePanel}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );

  const gamesNode = shown.length === 0 ? emptyNode : gridNode;

  return (
    <div className="split">
      {sidebar}
      <div className="main games-main">
        <div className="games-body" ref={bodyRef}>
          <div className="app-head app-head-games">
            <div className="folder-title">
              <h1>
                <b>Игры</b>
              </h1>
              {loaded ? (
                <span className="folder-count">
                  {root ? <span className="folder-count-n">{shown.length}</span> : null}
                  <span className="folder-count-note">{countNote}</span>
                </span>
              ) : null}
            </div>

            {root && games.length > 0 ? (
              <div className="sort-switch games-status-switch" role="group" aria-label="Фильтр по статусу">
                {STATUS_FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={status === item.value}
                    onClick={() => setStatus(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="acts">
              <button type="button" className="btn-primary head-add" onClick={checkNow} disabled={busy || !root}>
                Проверить обновления
                <span className="head-add-circle" aria-hidden="true">
                  <Icon name="reset" />
                </span>
              </button>
            </div>

            {root ? (
              <TagFilterBar
                tagCounts={tagCounts}
                selectedTags={tag ? [tag] : []}
                onToggleTag={(name) => setTag(tag === name ? null : name)}
                onClearTags={() => setTag(null)}
              />
            ) : null}
          </div>

          {(root && !rootAvailable) || error || groups.length > 0 ? (
            <div className="games-notes">
              {groups.length > 0 ? (
                <GameVersionsNote
                  group={groups[0]}
                  others={groups.length - 1}
                  games={gamesById}
                  onCompare={() => setMergeIds(groups[0].ids)}
                />
              ) : null}
              {root && !rootAvailable ? (
                <ShowcaseNote
                  icon="alert"
                  className="games-note-warn"
                  action={{ label: "Выбрать папку", icon: "folder", onClick: pickRoot }}
                >
                  Папка {root} сейчас недоступна — карточки сохранены.
                </ShowcaseNote>
              ) : null}
              {error ? (
                <ShowcaseNote icon="alert" className="games-note-danger">
                  {error}
                </ShowcaseNote>
              ) : null}
            </div>
          ) : null}

          {!loaded ? null : !root ? (
            <GamesEmpty
              icon="folder"
              title="Выберите папку с играми"
              text="Каждая игра из неё станет карточкой, новые папки Booked заметит сам."
              action={{ label: "Выбрать папку", icon: "folder", disabled: busy, onClick: pickRoot }}
            />
          ) : searching ? (
            <div className={"games-search" + (bookmarkHits.length > 0 ? " with-hits" : "")}>
              <div className="games-search-col">
                <div className="games-search-head">
                  <span className="band-head">
                    Игры <span className="band-head-count">{shown.length}</span>
                  </span>
                </div>
                {gamesNode}
              </div>
              {bookmarkHits.length > 0 ? (
                <section className="games-search-col" aria-label="Найденные закладки">
                  <div className="games-search-head">
                    <span className="band-head">
                      Закладки <span className="band-head-count">{bookmarkHits.length}</span>
                    </span>
                    <button type="button" className="link-button" onClick={onGoToBookmarks}>
                      Показать все
                      <Icon name="arrow-right" className="link-button-chevron" />
                    </button>
                  </div>
                  <div className="games-hits">
                    {bookmarkHits.slice(0, 8).map((bookmark) => {
                      const host = hostOf(bookmark.url);
                      return (
                        <button
                          key={bookmark.id}
                          type="button"
                          className="games-hit"
                          onClick={() => onOpenBookmark(bookmark)}
                        >
                          <span className="games-hit-mark" aria-hidden="true">
                            {host.charAt(0).toUpperCase() || "?"}
                          </span>
                          <span className="games-hit-text">
                            <span className="games-hit-title">{bookmark.title}</span>
                            <span className="games-hit-host">{host}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            gamesNode
          )}
        </div>
      </div>

      {menu && menuGame ? (
        <ContextMenu
          groups={buildGameMenu({
            installed: menuGame.folderPath !== null,
            onLaunch: () => handleLaunch(menuGame.id),
            onPickExe: () => setDialog({ id: menuGame.id, kind: "exe" }),
            onEdit: () => setDialog({ id: menuGame.id, kind: "edit" }),
            onNewVersion: () => setPickFor(menuGame.id),
            onDeleteFolder: () => setDialog({ id: menuGame.id, kind: "folder" }),
            onForget: () => setDialog({ id: menuGame.id, kind: "forget" }),
          })}
          anchor={menu.anchor}
          ariaLabel={`Меню игры ${menuGame.title}`}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {mergeIds ? (
        <Modal onClose={() => setMergeIds(null)} titleId="game-merge-title">
          <GameMergeDialog
            ids={mergeIds}
            games={gamesById}
            titleId="game-merge-title"
            busy={mergeBusy}
            onClose={() => setMergeIds(null)}
            onDistinct={markDistinct}
            onMerge={startMerge}
          />
        </Modal>
      ) : pickFor !== null && gamesById.has(pickFor) ? (
        <Modal onClose={() => setPickFor(null)} titleId="game-pick-title">
          <GameVersionPick
            game={gamesById.get(pickFor) as Game}
            games={visibleGames.filter((game) => !pendingIds.has(game.id))}
            titleId="game-pick-title"
            onClose={() => setPickFor(null)}
            onPick={(oldId) => {
              const current = pickFor;
              setPickFor(null);
              setMergeIds([oldId, current]);
            }}
          />
        </Modal>
      ) : permanent ? (
        <Modal onClose={() => !mergeBusy && updateMerges(() => ({ permanent: null }))} titleId="game-permanent-title">
          <GameMergePermanentDialog
            folder={permanent.folder}
            bytes={permanent.bytes}
            titleId="game-permanent-title"
            busy={mergeBusy}
            onClose={() => !mergeBusy && updateMerges(() => ({ permanent: null }))}
            onConfirm={() => confirmPermanent(permanent)}
          />
        </Modal>
      ) : null}

      {toastStack
        ? createPortal(
            waitingMerges.map((entry) => (
              <GameMergeToast
                key={entry.key}
                text={entry.text}
                delayMs={MERGE_DELAY_MS}
                startedAt={entry.startedAt}
                onHold={(held) => holdMerge(entry, held)}
                onUndo={() => undoMerge(entry)}
              />
            )),
            toastStack,
          )
        : null}

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
