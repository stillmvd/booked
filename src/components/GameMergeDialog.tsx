import { useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { gameMergePreview } from "../lib/api";
import { formatSize } from "../lib/gameFormat";
import {
  changedLabel,
  DATA_LINE,
  exeLabel,
  leavingLine,
  matchLine,
  mergeVerb,
  rowSubline,
  savesFact,
  savesLabel,
  windowTitle,
} from "../lib/gameVersions";
import type { Game, GameMergeFolder, GameMergePreview } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { DialogFact, DialogHead, DialogPocket, SubmitMark } from "./DialogHead";
import { GamePlate } from "./GamePlate";
import { Icon } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

export interface GameMergeChoice {
  ids: number[];
  keptId: number;
}

interface GameMergeDialogProps {
  ids: number[];
  games: ReadonlyMap<number, Game>;
  titleId: string;
  busy: boolean;
  onClose: () => void;
  onDistinct: (ids: number[]) => void;
  onMerge: (choice: GameMergeChoice) => void;
}

interface Row {
  label: string;
  was: string;
  next: string;
  mono?: boolean;
}

const PAIR_LABELS = ["Сейчас установлена", "Новая"];
const COLUMN_FATES = { kept: "останется", trash: "в Корзину", gone: "папки нет" };
const PAIR_DATA_LINE = "Карточка останется одна — оценка, статус, обложка, страница и теги сохранятся";

export function GameMergeDialog({ ids, games, titleId, busy, onClose, onDistinct, onMerge }: GameMergeDialogProps) {
  const [preview, setPreview] = useState<GameMergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keptId, setKeptId] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
  const idsKey = ids.join(",");

  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError(null);
    gameMergePreview(idsKey.split(",").map(Number))
      .then((result) => {
        if (!alive) return;
        setPreview(result);
        setKeptId(result.keptId);
      })
      .catch((err) => alive && setError(userMessage(err)));
    return () => {
      alive = false;
    };
  }, [idsKey]);

  const order = preview?.ids ?? ids;
  const cards = order.map((id) => games.get(id)).filter((game): game is Game => game !== undefined);
  const folders = useMemo(() => new Map((preview?.folders ?? []).map((folder) => [folder.id, folder])), [preview]);
  const kept = keptId === null ? undefined : games.get(keptId);
  const leaving = cards
    .filter((game) => game.id !== keptId && folders.has(game.id))
    .map((game) => {
      const folder = folders.get(game.id) as GameMergeFolder;
      return { name: game.folderName ?? game.title, bytes: folder.sizeBytes, saves: folder.saves };
    });
  const reasons = preview?.reasons ?? null;
  const pair = cards.length === 2;
  const keepsNewest = keptId !== null && keptId === cards[cards.length - 1]?.id;
  const keptSaves = keptId === null ? 0 : (folders.get(keptId)?.saves ?? 0);
  const leavingSaves = leaving.reduce((sum, folder) => sum + folder.saves, 0);
  const ready = preview !== null && keptId !== null && cards.length === order.length && cards.length >= 2;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || keptId === null) return;
    onMerge({ ids: order, keptId });
  }

  function folderFacts(game: Game) {
    const folder = folders.get(game.id);
    return {
      onDisk: folder !== undefined,
      size: folder ? formatSize(folder.sizeBytes) : "—",
      changed: folder ? changedLabel(folder.modified) : "—",
      saves: savesLabel(folder?.saves, folder !== undefined),
    };
  }

  function detailRows(was: Game, next: Game): Row[] {
    const a = folderFacts(was);
    const b = folderFacts(next);
    return [
      { label: "Версия", was: was.versionInstalled ?? "без версии", next: next.versionInstalled ?? "без версии" },
      {
        label: "Папка",
        was: a.onDisk ? (was.folderName ?? "—") : "нет на диске",
        next: b.onDisk ? (next.folderName ?? "—") : "нет на диске",
        mono: true,
      },
      { label: "Изменена", was: a.changed, next: b.changed },
      { label: "Размер", was: a.size, next: b.size },
      { label: "Движок", was: was.engine ?? "—", next: next.engine ?? "—" },
      { label: "exe", was: exeLabel(was), next: exeLabel(next), mono: true },
      { label: "Сохранения", was: a.saves, next: b.saves },
    ];
  }

  function listKeys(event: KeyboardEvent<HTMLDivElement>) {
    const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-id]:enabled"), (button) =>
      Number(button.dataset.id),
    );
    if (keptId === null || choices.length < 2) return;
    const at = choices.indexOf(keptId);
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? choices[(at + 1) % choices.length]
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? choices[(at - 1 + choices.length) % choices.length]
          : event.key === "Home"
            ? choices[0]
            : event.key === "End"
              ? choices[choices.length - 1]
              : null;
    if (next === null) return;
    event.preventDefault();
    setKeptId(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus();
  }

  const newestFirst = [...cards].reverse();

  function withCover(game: Game): Game {
    const shared = cards.find((card) => card.image !== null);
    if (game.image !== null || !shared) return game;
    return { ...game, image: shared.image, imageX: shared.imageX, imageY: shared.imageY };
  }

  function fate(game: Game): { text: string; tone: "kept" | "trash" | "gone" } {
    if (game.id === keptId) return { text: "Останется", tone: "kept" };
    return folders.has(game.id) ? { text: "Уйдёт в Корзину", tone: "trash" } : { text: "Папки нет на диске", tone: "gone" };
  }

  return (
    <form className="dialog game-merge-dialog" onSubmit={submit}>
      <DialogHead id={titleId} title={windowTitle(cards.length, cards[0]?.title ?? "")} onClose={onClose} />

      {error ? (
        <ShowcaseNote icon="alert" className="games-note-danger">
          {error}
        </ShowcaseNote>
      ) : preview === null ? (
        <p className="game-merge-wait">Сравниваю папки…</p>
      ) : (
        <>
          <p className="game-merge-sub">
            {cards[0]?.title} · {matchLine(reasons)}
          </p>

          {pair ? (
            <>
              <div className="dialog-pocket game-merge-cards" role="radiogroup" aria-label="Какая папка останется" onKeyDown={listKeys}>
                {cards.map((game, index) => {
                  const folder = folders.get(game.id);
                  const isKept = game.id === keptId;
                  const state = fate(game);
                  return (
                    <button
                      key={game.id}
                      type="button"
                      role="radio"
                      data-id={game.id}
                      aria-checked={isKept}
                      tabIndex={isKept ? 0 : -1}
                      disabled={!folder}
                      className="game-merge-card"
                      onClick={() => setKeptId(game.id)}
                    >
                      <GamePlate game={withCover(game)} className="game-merge-cover" />
                      <span className={`game-merge-badge ${state.tone}`}>{state.text}</span>
                      <span className="game-merge-card-text">
                        <span className="game-merge-card-label">{PAIR_LABELS[index]}</span>
                        <span className="game-merge-card-version">{game.versionInstalled ?? "без версии"}</span>
                        <span className="game-merge-card-meta">
                          {folder ? `${changedLabel(folder.modified)} · ${formatSize(folder.sizeBytes)}` : "Папки нет на диске"}
                        </span>
                        <span className="game-merge-card-folder" title={game.folderName ?? undefined}>
                          {game.folderName ?? "—"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <DialogPocket className="game-merge-facts">
                <DialogFact icon="shield">{PAIR_DATA_LINE}</DialogFact>
                <DialogFact icon="file">{savesFact(leavingSaves, keptSaves, keepsNewest)}</DialogFact>
              </DialogPocket>

              <button
                type="button"
                className="game-merge-more"
                aria-expanded={details}
                aria-controls={`${titleId}-details`}
                onClick={() => setDetails((open) => !open)}
              >
                <Icon name={details ? "chevron-up" : "chevron-down"} />
                Сравнить папки подробно
              </button>

              {details ? (
                <div className="game-merge-details" id={`${titleId}-details`}>
                  <table className="game-merge-table">
                    <colgroup>
                      <col className="game-merge-col-label" />
                      <col />
                      <col />
                    </colgroup>
                    <thead>
                      <tr>
                        <td />
                        {cards.map((game, index) => (
                          <th key={game.id} scope="col" className={fate(game).tone}>
                            {index === 0 ? "Сейчас" : "Новая"} · {COLUMN_FATES[fate(game).tone]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows(cards[0], cards[1]).map((row) => {
                        const differs = row.was !== row.next;
                        return (
                          <tr key={row.label}>
                            <th scope="row">{row.label}</th>
                            {[row.was, row.next].map((value, index) => (
                              <td
                                key={index}
                                className={
                                  (row.mono ? "mono" : "") + (differs && cards[index].id === keptId ? " strong" : "")
                                }
                              >
                                {value}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="game-merge-list" role="radiogroup" aria-label="Какая папка останется" onKeyDown={listKeys}>
                {newestFirst.map((game) => {
                  const folder = folders.get(game.id);
                  const isKept = game.id === keptId;
                  return (
                    <button
                      key={game.id}
                      type="button"
                      role="radio"
                      data-id={game.id}
                      aria-checked={isKept}
                      tabIndex={isKept ? 0 : -1}
                      disabled={!folder}
                      className={"game-merge-row" + (isKept ? " kept" : "")}
                      onClick={() => setKeptId(game.id)}
                    >
                      <GamePlate game={game} className="game-merge-avatar" />
                      <span className="game-merge-row-text">
                        <span className="game-merge-row-name">{game.folderName ?? game.title}</span>
                        <span className="game-merge-row-sub">
                          {rowSubline(game, folder?.sizeBytes ?? null, folder?.modified ?? null) || "Папки нет на диске"}
                        </span>
                      </span>
                      <span className={"game-merge-state " + (isKept ? "kept" : folder ? "trash" : "gone")}>
                        {isKept ? <Icon name="check" /> : folder ? <Icon name="trash" /> : null}
                        {isKept ? "Остаётся" : folder ? "В Корзину" : "Папки нет"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="game-merge-consequence">
                {leavingLine(leaving)} {DATA_LINE}
              </p>
            </>
          )}
        </>
      )}

      <div className="form-actions game-merge-actions">
        <button
          type="button"
          className="game-merge-distinct"
          disabled={busy || cards.length < 2}
          onClick={() => onDistinct(order)}
        >
          <Icon name="blocked" />
          Это разные игры
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" disabled={!ready || busy}>
          {kept ? mergeVerb(kept, cards.length, keepsNewest) : "Обновить"}
          <SubmitMark />
        </button>
      </div>
    </form>
  );
}
