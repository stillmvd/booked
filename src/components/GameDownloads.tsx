import { useState } from "react";

import { queueCapsuleLabel, rowLabel, rowPercent } from "../lib/downloads";
import { cancelDownload, dismissDownloads, retryDownload } from "../lib/downloadsStore";
import { readStored, writeStored } from "../lib/storage";
import type { DownloadRow, DownloadSnapshot } from "../lib/types";
import { Icon } from "./Icon";

const FOLDED_KEY = "booked.games.downloadsFolded";

const BAR_STATES: DownloadRow["state"][] = ["waiting", "resolving", "downloading", "unpacking"];

function barWidth(row: DownloadRow): number {
  if (row.state === "unpacking") return rowPercent(row) ?? 100;
  return rowPercent(row) ?? 0;
}

function QueueRow({ row }: { row: DownloadRow }) {
  const label = rowLabel(row);
  return (
    <li className="gdl-row" data-state={row.state}>
      <div className="gdl-row-top">
        <span className="gdl-row-name">{row.title}</span>
        <button
          type="button"
          className="gdl-row-x"
          aria-label={`Убрать из очереди: ${row.title}`}
          onClick={() => void cancelDownload(row.id).catch(() => undefined)}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="gdl-row-meta">
        <span className="gdl-row-label">
          {row.state === "done" ? <Icon name="check" /> : null}
          {label}
        </span>
        {row.state === "failed" ? (
          <button
            type="button"
            className="gdl-row-retry"
            onClick={() => void retryDownload(row.id).catch(() => undefined)}
          >
            Повторить
          </button>
        ) : null}
      </div>
      {BAR_STATES.includes(row.state) ? (
        <span className="gdl-bar-track" aria-hidden="true">
          <i style={{ width: `${barWidth(row)}%` }} />
        </span>
      ) : null}
    </li>
  );
}

export function GameDownloads({ snapshot }: { snapshot: DownloadSnapshot }) {
  const [folded, setFolded] = useState(() => readStored<boolean>(FOLDED_KEY, false));
  const { rows } = snapshot;
  if (rows.length === 0) return null;

  function toggle() {
    setFolded((current) => {
      writeStored(FOLDED_KEY, !current);
      return !current;
    });
  }

  if (folded) {
    return (
      <div className="gdl-dock">
        <button type="button" className="gdl-capsule" aria-expanded={false} onClick={toggle}>
          <Icon name="download" />
          <span>{queueCapsuleLabel(rows)}</span>
          <span className="gdl-fold" aria-hidden="true">
            <Icon name="chevron-up" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="gdl-dock">
      <section className="gdl-queue" aria-label="Загрузки">
        <div className="gdl-head">
          <h2>Загрузки</h2>
          <i className="gdl-count">{rows.length}</i>
          {rows.some((row) => row.state === "done") ? (
            <button type="button" className="gdl-clear" onClick={() => void dismissDownloads().catch(() => undefined)}>
              Убрать готовые
            </button>
          ) : null}
          <button type="button" className="gdl-fold" aria-expanded={true} aria-label="Свернуть загрузки" onClick={toggle}>
            <Icon name="chevron-down" />
          </button>
        </div>
        <ul className="gdl-rows">
          {rows.map((row) => (
            <QueueRow key={row.id} row={row} />
          ))}
        </ul>
      </section>
    </div>
  );
}
