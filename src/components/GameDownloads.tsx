import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { gameDownloadReveal, gridMediaSrc } from "../lib/api";
import { hostLabel, queueStatus, rowLabel, rowPercent, rowPhase, type QueueMood } from "../lib/downloads";
import { cancelDownload, dismissDownloads, retryDownload } from "../lib/downloadsStore";
import { readStored, writeStored } from "../lib/storage";
import type { DownloadRow, DownloadSnapshot, Game } from "../lib/types";
import { Icon, type IconName } from "./Icon";

const FOLDED_KEY = "booked.games.downloadsFolded";
const NBSP = " ";

const BAR_STATES: DownloadRow["state"][] = ["waiting", "resolving", "downloading", "unpacking"];

const STATE_ICON: Record<DownloadRow["state"], IconName> = {
  waiting: "clock",
  resolving: "link",
  downloading: "arrow-down",
  unpacking: "folder",
  done: "check",
  failed: "alert",
};

const MOOD_ICON: Record<QueueMood, IconName> = {
  waiting: "clock",
  resolving: "link",
  downloading: "arrow-down",
  unpacking: "folder",
  done: "check",
  failed: "alert",
  paused: "alert",
};

function QueueRow({ row, cover, next, index }: { row: DownloadRow; cover: string | null; next: boolean; index: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const percent = rowPercent(row);
  const detail = rowLabel(row) || (next ? "Следующая" : "");
  const running = row.state === "resolving" || row.state === "downloading" || row.state === "unpacking";
  const stop = running ? "Отменить загрузку" : "Убрать из очереди";
  const loose = running && percent === null;
  const shown = cover !== failedSrc ? cover : null;
  return (
    <li className="gdl-row" data-state={row.state} style={{ "--i": index } as CSSProperties}>
      <span className={"gdl-thumb" + (shown ? "" : " letter")} aria-hidden="true">
        {shown ? <img src={shown} alt="" draggable={false} onError={() => setFailedSrc(shown)} /> : row.title.trim().charAt(0).toUpperCase()}
        <i className="gdl-badge">
          <Icon name={STATE_ICON[row.state]} />
        </i>
      </span>
      <div className="gdl-row-body">
        <span className="gdl-row-name" title={row.title}>
          {row.title}
        </span>
        <div className="gdl-row-meta">
          <span className="gdl-row-phase">{rowPhase(row)}</span>
          {row.host && row.state !== "waiting" ? (
            <span className="gdl-row-host" title={`Файлообменник: ${hostLabel(row.host)}`}>
              <Icon name="globe" />
              {hostLabel(row.host)}
            </span>
          ) : null}
          {percent !== null && row.state !== "done" ? (
            <b className="gdl-row-pct">
              {percent}
              {NBSP}%
            </b>
          ) : null}
          {row.state === "failed" ? (
            <button type="button" className="gdl-row-retry" onClick={() => void retryDownload(row.id).catch(() => undefined)}>
              Повторить
            </button>
          ) : null}
          {row.state === "failed" && row.reason === "unpack" ? (
            <button type="button" className="gdl-row-retry" onClick={() => void gameDownloadReveal(row.id).catch(() => undefined)}>
              Показать архив
            </button>
          ) : null}
        </div>
        {BAR_STATES.includes(row.state) ? (
          <span className={"gdl-bar-track" + (loose ? " loose" : "")} aria-hidden="true">
            <i style={loose ? undefined : { width: `${percent ?? 0}%` }} />
          </span>
        ) : null}
        <div className="gdl-row-detail">
          <span className="gdl-row-label">{detail}</span>
        </div>
      </div>
      <button
        type="button"
        className="gdl-row-x"
        aria-label={`${stop}: ${row.title}`}
        title={stop}
        onClick={() => void cancelDownload(row.id).catch(() => undefined)}
      >
        <Icon name="close" />
      </button>
    </li>
  );
}

export function GameDownloads({ snapshot, games }: { snapshot: DownloadSnapshot; games: Game[] }) {
  const [folded, setFolded] = useState(() => readStored<boolean>(FOLDED_KEY, false));
  const panel = useRef<HTMLElement>(null);
  const { rows } = snapshot;
  const open = !folded && rows.length > 0;

  const covers = useMemo(() => {
    const wanted = new Set(rows.map((row) => row.game));
    const map = new Map<number, string | null>();
    for (const game of games) {
      if (wanted.has(game.id)) map.set(game.id, gridMediaSrc(game.image ? ["images", game.image] : null, game.imageZoom));
    }
    return map;
  }, [rows, games]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (e.target instanceof Node && panel.current?.contains(e.target)) return;
      writeStored(FOLDED_KEY, true);
      setFolded(true);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !panel.current?.contains(document.activeElement)) return;
      writeStored(FOLDED_KEY, true);
      setFolded(true);
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (rows.length === 0) return null;

  function toggle() {
    setFolded((current) => {
      writeStored(FOLDED_KEY, !current);
      return !current;
    });
  }

  const status = queueStatus(snapshot);
  const nextId = rows.find((row) => row.state === "waiting")?.id;

  if (folded) {
    return (
      <div className="gdl-dock">
        <button type="button" className="gdl-capsule" data-mood={status.mood} aria-expanded={false} title="Показать загрузки" onClick={toggle}>
          <i className="gdl-capsule-fill" style={{ transform: `scaleX(${(status.percent ?? 0) / 100})` }} aria-hidden="true" />
          <span className="gdl-capsule-icon" aria-hidden="true">
            <Icon name={MOOD_ICON[status.mood]} />
          </span>
          <span className="gdl-capsule-text">{status.text}</span>
          <span className="gdl-fold" aria-hidden="true">
            <Icon name="chevron-up" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="gdl-dock">
      <section ref={panel} className="gdl-queue" aria-label="Загрузки">
        <div className="gdl-head">
          <h2>Загрузки</h2>
          <i className="gdl-count">{rows.length}</i>
          <span className="gdl-sum" data-mood={status.mood}>
            {status.text}
          </span>
          {rows.some((row) => row.state === "done") ? (
            <button type="button" className="gdl-clear" onClick={() => void dismissDownloads().catch(() => undefined)}>
              Убрать готовые
            </button>
          ) : null}
          <button type="button" className="gdl-fold" aria-expanded={true} aria-label="Свернуть загрузки" title="Свернуть" onClick={toggle}>
            <Icon name="chevron-down" />
          </button>
        </div>
        <ul className="gdl-rows">
          {rows.map((row, index) => (
            <QueueRow
              key={row.id}
              row={row}
              cover={covers.get(row.game) ?? null}
              next={row.id === nextId && rows.length > 1}
              index={index}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
