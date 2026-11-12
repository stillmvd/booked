import { Fragment, memo, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { forgetThumb, gridMediaSrc, knownMediaSrc } from "../lib/api";
import { coverStyle } from "../lib/coverFrame";
import { KEYBOARD_FOCUS } from "../lib/focusModality";
import { finishedLabel, PLAY_CHIP_SECS, playTime, wantsRating } from "../lib/gameFields";
import { devStatusLabel, formatSiteStamp, formatSize, runLabel, showsUpdateMark, STATUS_LABELS, updateLabel, withV } from "../lib/gameFormat";
import type { Rect } from "../lib/menuPosition";
import type { Game, GameRunPhase } from "../lib/types";
import { SplitName } from "./Highlighted";
import { Icon } from "./Icon";

const SOURCE_LABELS: Record<string, string> = {
  f95: "F95zone",
  itch: "itch.io",
};

const TIP_DELAY = 300;
const TIP_GAP = 8;
const TIP_HEIGHT = 64;

interface GameCardProps {
  game: Game;
  selected: boolean;
  open: boolean;
  onSelect: (id: number) => void;
  onRate: (id: number, rating: number) => void;
  onFavorite?: (id: number, favorite: boolean) => void;
  onMenu: (id: number, anchor: Rect) => void;
  onLaunch: (id: number) => void;
  onOpenPage: (id: number) => void;
  newVersion?: boolean;
  onVersions?: (id: number) => void;
  fullCover?: boolean;
  run?: GameRunPhase;
  runStartedAt?: number;
  pickable?: boolean;
  picked?: boolean;
  picking?: boolean;
  onPick?: (id: number) => void;
  progress?: number | null;
}

const RUN_TICK = 15_000;
const RUN_LEAVE = 400;

function RunLabel({ id, phase, startedAt }: { id: string; phase: GameRunPhase; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== "running") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), RUN_TICK);
    return () => window.clearInterval(timer);
  }, [phase]);
  if (phase === "launching") {
    return (
      <span className="game-run-label" id={id}>
        <span className="game-run-long">Запускается…</span>
        <span className="game-run-short">Запуск…</span>
      </span>
    );
  }
  const text = runLabel(startedAt, now);
  const cut = text.indexOf(" ");
  return (
    <span className="game-run-label" id={id}>
      {cut < 0 ? text : (
        <>
          {text.slice(0, cut)} <small>{text.slice(cut + 1)}</small>
        </>
      )}
    </span>
  );
}

function useLeaving(run: GameRunPhase | undefined): boolean {
  const [prev, setPrev] = useState(run);
  const [leaving, setLeaving] = useState(false);
  if (prev !== run) {
    setPrev(run);
    setLeaving(prev !== undefined && run === undefined);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), RUN_LEAVE);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  return leaving;
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? "star on" : "star off"}>
      <path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
    </svg>
  );
}

interface TipPosition {
  right: number;
  top?: number;
  bottom?: number;
}

interface UpdateMarkProps {
  id: string;
  label: string;
  text: string;
  onOpen: () => void;
}

function useTip(height: number) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const [tip, setTip] = useState<TipPosition | null>(null);

  const hide = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };

  const show = (delay = TIP_DELAY) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const right = document.documentElement.clientWidth - rect.right;
      const below = rect.bottom + TIP_GAP + height <= window.innerHeight;
      setTip(below ? { right, top: rect.bottom + TIP_GAP } : { right, bottom: window.innerHeight - rect.top + TIP_GAP });
    }, delay);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!tip) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);

  return { ref, tip, show, hide };
}

function NoteMark({ id, note }: { id: string; note: string }) {
  const { ref, tip, show, hide } = useTip(Math.min(200, 28 + Math.ceil(note.length / 34) * 17));
  return (
    <button
      ref={ref}
      type="button"
      className="game-note-mark"
      aria-label="Заметка"
      aria-describedby={id}
      onMouseEnter={() => show()}
      onMouseLeave={hide}
      onFocus={(e) => {
        if (e.currentTarget.matches(KEYBOARD_FOCUS)) show(0);
      }}
      onBlur={hide}
      onClick={() => show(0)}
    >
      <Icon name="edit" />
      <span className="game-update-text" id={id}>
        {note}
      </span>
      {tip
        ? createPortal(
            <div className="game-note-tip" role="tooltip" style={tip}>
              {note}
            </div>,
            document.body,
          )
        : null}
    </button>
  );
}

function TagLine({ id, tags, forum, onSelect }: { id: string; tags: string[]; forum: string[]; onSelect: () => void }) {
  return (
    <button type="button" className="game-taglist" id={id} title={tags.join(" · ")} onClick={onSelect}>
      {tags.map((name, index) => (
        <Fragment key={name}>
          {index > 0 ? " · " : null}
          {forum.includes(name) ? (
            <span className="game-tagname forum">
              <Icon name="globe" />
              {name}
            </span>
          ) : (
            name
          )}
        </Fragment>
      ))}
    </button>
  );
}

function UpdateMark({ id, label, text, onOpen }: UpdateMarkProps) {
  const { ref, tip, show, hide } = useTip(TIP_HEIGHT);

  return (
    <button
      ref={ref}
      type="button"
      className="game-update-mark"
      aria-label="Открыть страницу игры"
      aria-describedby={id}
      onMouseEnter={() => show()}
      onMouseLeave={hide}
      onFocus={(e) => {
        if (e.currentTarget.matches(KEYBOARD_FOCUS)) show();
      }}
      onBlur={hide}
      onClick={(e) => {
        hide();
        if (e.detail <= 1) onOpen();
      }}
    >
      <span className="game-update-label">{label}</span>
      <span className="game-update-text" id={id}>
        Доступно обновление. {text}
      </span>
      {tip
        ? createPortal(
            <div className="game-update-tip" role="tooltip" style={tip}>
              <b>Доступно обновление</b>
              <span>{text}</span>
            </div>,
            document.body,
          )
        : null}
    </button>
  );
}

export const GameCard = memo(function GameCard({
  game,
  selected,
  open,
  onSelect,
  onRate,
  onFavorite,
  onMenu,
  onLaunch,
  onOpenPage,
  newVersion = false,
  onVersions,
  fullCover = false,
  run,
  runStartedAt = 0,
  pickable = false,
  picked = false,
  picking = false,
  onPick,
  progress,
}: GameCardProps) {
  const leaving = useLeaving(run);
  const segments = game.image ? ["images", game.image] : null;
  const src = fullCover ? knownMediaSrc(segments) : gridMediaSrc(segments, game.imageZoom);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const cover = src !== failedSrc ? src : null;
  const baseId = useId();
  const installed = game.folderPath !== null;
  const wish = !installed && game.status === "wish";
  const badge = showsUpdateMark(game) ?updateLabel(game.source, game.siteVersion, game.versionInstalled) : "";

  const canLaunch = installed && game.exePath !== null;
  const openable = /^https?:\/\/\S/i.test(game.pageUrl ?? "");
  const playHint = installed
    ? canLaunch
      ? `Запустить ${game.title}`
      : "Не нашлось, что запускать — выбери файл вручную"
    : "Папки нет на диске";

  const version = wish ? game.siteVersion : game.versionInstalled;
  const versionLabel = version === null ? "" : withV(version);
  const siteLabel = !badge || !game.siteVersion ? "" : game.source === "itch" ? formatSiteStamp(game.siteVersion) : withV(game.siteVersion);
  const size = formatSize(game.sizeBytes);
  const devStatus = devStatusLabel(game.devStatus) || (wish && game.source === "f95" ? "В разработке" : "");
  const hasTags = game.tags.length > 0;
  const describedBy = [
    badge ? `${baseId}-update` : "",
    run ? `${baseId}-run` : "",
    hasTags ? `${baseId}-tags` : "",
    `${baseId}-facts`,
    `${baseId}-line`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={"game-card" + (wish ? " wish" : installed ? "" : " gone") + (selected ? " selected" : "") + (picked ? " picked" : "")}
      data-engine={game.engine ?? undefined}
      data-open={open || undefined}
      data-picking={picking || undefined}
      data-game-id={game.id}
      data-run={run}
      data-run-leaving={leaving || undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const keyboard = e.detail === 0 && e.button !== 2;
        const anchor = keyboard
          ? e.currentTarget.getBoundingClientRect()
          : { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY };
        onMenu(game.id, anchor);
      }}
    >
      <button
        type="button"
        className="game-card-open"
        aria-expanded={open}
        aria-labelledby={`${baseId}-title`}
        aria-describedby={describedBy}
        onClick={() => onSelect(game.id)}
      />

      <span className={"game-cover" + (cover ? "" : " letter")}>
        {cover ? (
          <img src={cover} alt="" style={coverStyle(game.imageX, game.imageY, game.imageZoom)} onError={() => {
              forgetThumb(segments);
              setFailedSrc(cover);
            }}
          />
        ) : (
          <span className="game-cover-letter" aria-hidden="true">
            {game.title.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        {wish && !pickable && progress === undefined ? (
          <span className="game-wish-mark" aria-hidden="true">
            <Icon name="heart-fill" />
          </span>
        ) : null}
        {game.status === "finished" && game.passedVersion ? (
          <span className="game-passed-mark" title={`Пройдена ${withV(game.passedVersion)}`}>
            <Icon name="check" />
            {withV(game.passedVersion)}
          </span>
        ) : null}
        {progress !== undefined ? (
          <span className="game-dl">
            {progress === null ? null : <span className="game-dl-pct">{progress}{" "}%</span>}
            <span
              className="game-dl-bar"
              role="progressbar"
              aria-label={`Скачивание: ${game.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress ?? undefined}
            >
              <i style={{ width: `${progress ?? 0}%` }} />
            </span>
          </span>
        ) : null}
        {badge ? (
          <UpdateMark id={`${baseId}-update`} label={siteLabel} text={badge} onOpen={() => onOpenPage(game.id)} />
        ) : null}
        {game.playSecs >= PLAY_CHIP_SECS && progress === undefined ? (
          <span className="gfl-time">
            <Icon name="clock" />
            {playTime(game.playSecs)}
          </span>
        ) : null}
      </span>

      {onFavorite && !picking ? (
        <button
          type="button"
          className="gfl-fav"
          data-update={badge ? "" : undefined}
          aria-pressed={game.favorite}
          aria-label={game.favorite ? "Убрать из избранного" : "В избранное"}
          onClick={(e) => {
            e.stopPropagation();
            onFavorite(game.id, !game.favorite);
          }}
        >
          <Icon name={game.favorite ? "star-fill" : "star"} />
        </button>
      ) : null}

      {pickable && progress === undefined && onPick ? (
        <button
          type="button"
          className="game-pick"
          aria-pressed={picked}
          aria-label={`Выбрать для скачивания: ${game.title}`}
          onClick={() => onPick(game.id)}
        >
          <Icon name="check" />
        </button>
      ) : null}

      {wish || installed ? (
        <span className="game-card-drop" aria-hidden="true">
          <span>
            <Icon name="download" />
            {wish ? "Распаковать в эту игру" : "Распаковать новую версию"}
          </span>
        </span>
      ) : null}

      <div className="game-pocket">
        <div className="game-card-body">
          <span className="game-title" id={`${baseId}-title`}>
            <SplitName text={game.title} />
          </span>
          {hasTags ? (
            <TagLine id={`${baseId}-tags`} tags={game.tags} forum={game.forumTags} onSelect={() => onSelect(game.id)} />
          ) : null}
          <span className="game-facts" id={`${baseId}-facts`}>
            {newVersion && onVersions ? (
              <button
                type="button"
                className="game-new-version"
                aria-label={`Новая версия? Сравнить ${game.title} с другой папкой`}
                onClick={() => onVersions(game.id)}
              >
                <Icon name="versions" />
                Новая версия?
              </button>
            ) : null}
            {!open && wantsRating(game) ? (
              <button
                type="button"
                className="gfl-rate"
                aria-label={`Оценить ${game.title}`}
                onClick={() => onSelect(game.id)}
              >
                <Icon name="star" />
                Оцени
              </button>
            ) : null}
            {game.source ? <span className="game-source">{SOURCE_LABELS[game.source]}</span> : null}
            {game.engine ? <span className="game-engine">{game.engine}</span> : null}
            {versionLabel ? (
              <span className="game-version">{versionLabel}</span>
            ) : wish ? null : (
              <span className="game-noversion">
                <Icon name="alert" />
                Версия неизвестна
              </span>
            )}
            {installed && game.notLaunchedSinceUpdate ? <span className="game-stale">Не запускалась после обновления</span> : null}
          </span>
          <span className="game-line" id={`${baseId}-line`}>
            {size ? <span>{size}</span> : null}
            {wish ? (
              devStatus ? <span>{devStatus}</span> : null
            ) : (
              <span className={"game-status " + game.status + (game.newSincePassed ? " fresh" : "")}>
                {game.newSincePassed
                  ? "Есть новое"
                  : game.status === "finished" && game.finishedAt !== null
                    ? `Пройдена ${finishedLabel(game.finishedAt)}`
                    : STATUS_LABELS[game.status]}
              </span>
            )}
            {installed || wish ? null : <span className="game-gone">Папки нет на диске</span>}
          </span>
        </div>

        <div className="game-foot">
          {wish ? null : (
            <div className="game-stars" role="group" aria-label={`Оценка игры ${game.title}`}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="star-btn"
                  aria-label={`${value} из 5`}
                  aria-pressed={game.rating === value}
                  onClick={() => onRate(game.id, game.rating === value ? 0 : value)}
                >
                  <Star filled={value <= game.rating} />
                </button>
              ))}
            </div>
          )}
          <div className="game-acts">
            {game.note.trim() !== "" ? <NoteMark id={`${baseId}-note`} note={game.note.trim()} /> : null}
            {openable ? (
              <button
                type="button"
                className="game-site"
                aria-label={wish ? `Открыть тред ${game.title}` : `Открыть страницу ${game.title}`}
                title={wish ? "Открыть тред" : "Открыть страницу игры"}
                onClick={() => onOpenPage(game.id)}
              >
                <Icon name="arrow-up-right" />
              </button>
            ) : null}
            {wish ? null : (
              <button
                type="button"
                className="game-play"
                disabled={!canLaunch || run !== undefined}
                aria-hidden={run ? true : undefined}
                tabIndex={run ? -1 : undefined}
                aria-label={playHint}
                title={run ? undefined : playHint}
                onClick={(e) => {
                  if (document.activeElement === e.currentTarget) {
                    e.currentTarget.closest(".game-card")?.querySelector<HTMLButtonElement>(".game-card-open")?.focus({ preventScroll: true });
                  }
                  onLaunch(game.id);
                }}
              >
                <Icon name="play" />
              </button>
            )}
            {run ? <RunLabel id={`${baseId}-run`} phase={run} startedAt={runStartedAt} /> : null}
          </div>
        </div>
      </div>
      {run || leaving ? (
        <span className="game-run" aria-hidden="true">
          <svg className="game-run-svg">
            <rect className="game-run-track" pathLength={100} />
            <rect className="game-run-line" pathLength={100} />
          </svg>
        </span>
      ) : null}
    </div>
  );
});
