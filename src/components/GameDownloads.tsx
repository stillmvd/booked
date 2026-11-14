import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { gameDownloadReveal, gameOpenDownload, gameOpenPage, gridMediaSrc } from "../lib/api";
import { queueStatus, rowLabel, rowPercent, rowPhase, type QueueMood } from "../lib/downloads";
import { cancelDownload, claimDownload, dismissDownloads, dismissUnclaimed, retryDownload, takeReveal } from "../lib/downloadsStore";
import { downloadPostIndex } from "../lib/gameFormat";
import { readStored, writeStored } from "../lib/storage";
import type { DownloadRow, DownloadSnapshot, Game, UnclaimedArchive } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { Icon, type IconName } from "./Icon";

const FOLDED_KEY = "booked.games.downloadsFolded";
const NBSP = " ";

const BAR_STATES: DownloadRow["state"][] = ["queued", "unpacking"];

const STATE_ICON: Record<DownloadRow["state"], IconName> = {
  waiting: "hourglass",
  queued: "file",
  unpacking: "folder",
  done: "check",
  failed: "alert",
};

const MOOD_ICON: Record<QueueMood, IconName> = {
  waiting: "hourglass",
  unclaimed: "file",
  queued: "file",
  unpacking: "folder",
  done: "check",
  failed: "alert",
};

function AskRow({ offer, rows, index }: { offer: UnclaimedArchive; rows: DownloadRow[]; index: number }) {
  const [error, setError] = useState("");
  const options = offer.options
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is DownloadRow => row !== undefined && row.state === "waiting");

  function claim(row: DownloadRow) {
    setError("");
    claimDownload(offer.id, row.id).catch((err) => setError(userMessage(err)));
  }

  return (
    <li className="gdl-row gdl-ask" data-state="unclaimed" style={{ "--i": index } as CSSProperties}>
      <span className="gdl-thumb letter" aria-hidden="true">
        <Icon name="file" />
      </span>
      <div className="gdl-row-body">
        <span className="gdl-row-name" title={offer.name}>
          {offer.name}
        </span>
        <div className="gdl-row-meta">
          <span className="gdl-row-phase">Чей архив?</span>
        </div>
        <div className="gdl-ask-options" role="group" aria-label={`Чей архив ${offer.name}`}>
          {options.map((row) => (
            <button key={row.id} type="button" className="gdl-row-retry" onClick={() => claim(row)}>
              {row.title}
            </button>
          ))}
        </div>
        {error ? (
          <span className="gdl-link-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="gdl-row-x"
        aria-label={`Не спрашивать про ${offer.name}`}
        title="Не игра из списка — больше не спрашивать"
        onClick={() => void dismissUnclaimed(offer.id).catch(() => undefined)}
      >
        <Icon name="close" />
      </button>
    </li>
  );
}

function QueueRow({
  row,
  game,
  cover,
  next,
  index,
}: {
  row: DownloadRow;
  game: Game | undefined;
  cover: string | null;
  next: boolean;
  index: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  const percent = rowPercent(row);
  const detail = (next ? "Следующая в очереди" : "") || rowLabel(row);
  const running = row.state === "unpacking";
  const stop = running ? "Остановить распаковку" : "Убрать из загрузок";
  const loose = running && percent === null;
  const shown = cover !== failedSrc ? cover : null;

  function openThread() {
    if (!game) return;
    setError("");
    const post = downloadPostIndex(game.downloadLinks);
    (post >= 0 ? gameOpenDownload(game.id, post) : gameOpenPage(game.id)).catch((err) => setError(userMessage(err)));
  }

  function reveal() {
    setError("");
    gameDownloadReveal(row.id).catch((err) => setError(userMessage(err)));
  }

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
          {row.state === "failed" && row.archiveName ? (
            <button type="button" className="gdl-row-retry" onClick={reveal}>
              Показать архив
            </button>
          ) : null}
          {row.state === "waiting" && game ? (
            <button type="button" className="gdl-row-retry gdl-link-open" title="Тема игры на F95 откроется в браузере" onClick={openThread}>
              Открыть тему
              <Icon name="arrow-up-right" />
            </button>
          ) : null}
        </div>
        {BAR_STATES.includes(row.state) ? (
          <span className={"gdl-bar-track" + (loose ? " loose" : "")} aria-hidden="true">
            <i style={loose ? undefined : { width: `${percent ?? 0}%` }} />
          </span>
        ) : null}
        {detail ? (
          <div className="gdl-row-detail">
            <span className="gdl-row-label">{detail}</span>
          </div>
        ) : null}
        {error ? (
          <span className="gdl-link-error" role="alert">
            {error}
          </span>
        ) : null}
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
  const { rows, unclaimed } = snapshot;
  const total = rows.length + unclaimed.length;
  const open = !folded && total > 0;

  const byId = useMemo(() => {
    const wanted = new Set(rows.map((row) => row.game));
    const map = new Map<number, { game: Game; cover: string | null }>();
    for (const game of games) {
      if (wanted.has(game.id)) map.set(game.id, { game, cover: gridMediaSrc(game.image ? ["images", game.image] : null, game.imageZoom) });
    }
    return map;
  }, [rows, games]);

  useEffect(() => {
    if (rows.some((row) => row.state === "waiting") && takeReveal()) {
      writeStored(FOLDED_KEY, false);
      setFolded(false);
    }
  }, [rows]);

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

  if (total === 0) return null;

  function toggle() {
    setFolded((current) => {
      writeStored(FOLDED_KEY, !current);
      return !current;
    });
  }

  const status = queueStatus(snapshot);
  const unpacking = rows.some((row) => row.state === "unpacking");
  const nextId = rows.find((row) => row.state === "queued")?.id;

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
          <i className="gdl-count">{total}</i>
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
          {unclaimed.map((offer, index) => (
            <AskRow key={`ask-${offer.id}`} offer={offer} rows={rows} index={index} />
          ))}
          {rows.map((row, index) => (
            <QueueRow
              key={row.id}
              row={row}
              game={byId.get(row.game)?.game}
              cover={byId.get(row.game)?.cover ?? null}
              next={unpacking && row.id === nextId}
              index={unclaimed.length + index}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
