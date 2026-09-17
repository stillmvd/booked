import { memo, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";

import { mediaPath } from "../lib/api";
import { positionStyle } from "../lib/coverFrame";
import { formatSiteStamp, formatSize, STATUS_LABELS, updateLabel, withV } from "../lib/gameFormat";
import type { Rect } from "../lib/menuPosition";
import type { Game } from "../lib/types";
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
  style?: CSSProperties;
  onSelect: (id: number) => void;
  onRate: (id: number, rating: number) => void;
  onMenu: (id: number, anchor: Rect) => void;
  onLaunch: (id: number) => void;
  onOpenPage: (id: number) => void;
  newVersion?: boolean;
  onVersions?: (id: number) => void;
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

function UpdateMark({ id, label, text, onOpen }: UpdateMarkProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const [tip, setTip] = useState<TipPosition | null>(null);

  const hide = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const right = document.documentElement.clientWidth - rect.right;
      const below = rect.bottom + TIP_GAP + TIP_HEIGHT <= window.innerHeight;
      setTip(below ? { right, top: rect.bottom + TIP_GAP } : { right, bottom: window.innerHeight - rect.top + TIP_GAP });
    }, TIP_DELAY);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!tip) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);

  return (
    <button
      ref={ref}
      type="button"
      className="game-update-mark"
      aria-label="Открыть страницу игры"
      aria-describedby={id}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) show();
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
  style,
  onSelect,
  onRate,
  onMenu,
  onLaunch,
  onOpenPage,
  newVersion = false,
  onVersions,
}: GameCardProps) {
  const [cover, setCover] = useState<string | null>(null);
  const baseId = useId();
  const installed = game.folderPath !== null;
  const badge = game.hasUpdate ? updateLabel(game.source, game.siteVersion, game.versionInstalled) : "";

  useEffect(() => {
    let alive = true;
    if (!game.image) {
      setCover(null);
      return;
    }
    mediaPath(["images", game.image])
      .then((full) => alive && setCover(convertFileSrc(full)))
      .catch(() => alive && setCover(null));
    return () => {
      alive = false;
    };
  }, [game.image]);

  const canLaunch = installed && game.exePath !== null;
  const playHint = installed
    ? canLaunch
      ? `Запустить ${game.title}`
      : "Не нашёл, что запускать — выберите файл вручную"
    : "Папки нет на диске";

  const version = game.versionInstalled;
  const versionLabel = version === null ? "" : withV(version);
  const siteLabel = !badge || !game.siteVersion ? "" : game.source === "itch" ? formatSiteStamp(game.siteVersion) : withV(game.siteVersion);
  const size = formatSize(game.sizeBytes);
  const describedBy = [badge ? `${baseId}-update` : "", `${baseId}-facts`, `${baseId}-line`].filter(Boolean).join(" ");

  return (
    <div
      className={"game-card" + (installed ? "" : " gone") + (selected ? " selected" : "")}
      data-engine={game.engine ?? undefined}
      data-open={open || undefined}
      data-morph={`card-${game.id}`}
      style={style}
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
          <img src={cover} alt="" style={{ objectPosition: positionStyle(game.imageX, game.imageY) }} />
        ) : (
          <span className="game-cover-letter" aria-hidden="true">
            {game.title.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        {badge ? (
          <UpdateMark id={`${baseId}-update`} label={siteLabel} text={badge} onOpen={() => onOpenPage(game.id)} />
        ) : null}
      </span>

      <div className="game-pocket">
        <div className="game-card-body">
          <span className="game-title" id={`${baseId}-title`}>
            <SplitName text={game.title} />
          </span>
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
            {game.source ? <span className="game-source">{SOURCE_LABELS[game.source]}</span> : null}
            {game.engine ? <span className="game-engine">{game.engine}</span> : null}
            {versionLabel ? (
              <span className="game-version">{versionLabel}</span>
            ) : (
              <span className="game-noversion">
                <Icon name="alert" />
                Версия неизвестна
              </span>
            )}
          </span>
          <span className="game-line" id={`${baseId}-line`}>
            {size ? <span>{size}</span> : null}
            <span className={"game-status " + game.status}>{STATUS_LABELS[game.status]}</span>
            {installed ? null : <span className="game-gone">Папки нет на диске</span>}
          </span>
        </div>

        {game.tags.length > 0 ? (
          <div className="game-tags">
            {game.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="game-tag">
                {tag}
              </span>
            ))}
            {game.tags.length > 3 ? <span className="game-tag more">Ещё {game.tags.length - 3}</span> : null}
          </div>
        ) : null}

        <div className="game-foot">
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
          <button
            type="button"
            className="game-play"
            disabled={!canLaunch}
            aria-label={playHint}
            title={playHint}
            onClick={() => onLaunch(game.id)}
          >
            <Icon name="play" />
          </button>
        </div>
      </div>
    </div>
  );
});
