import { useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { gameMergePreview } from "../lib/api";
import { formatSize } from "../lib/gameFormat";
import {
  changedLabel,
  DATA_LINE,
  exeLabel,
  keepLabel,
  leavingLine,
  mergeVerb,
  pageLabel,
  ratingLabel,
  reasonChips,
  rowSubline,
  savesLabel,
  windowTitle,
} from "../lib/gameVersions";
import type { Game, GameMergeFolder, GameMergePreview } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { DialogHead, SubmitMark } from "./DialogHead";
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
  same: boolean;
  mono?: boolean;
}

export function GameMergeDialog({ ids, games, titleId, busy, onClose, onDistinct, onMerge }: GameMergeDialogProps) {
  const [preview, setPreview] = useState<GameMergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keptId, setKeptId] = useState<number | null>(null);
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
  const chips = reasonChips(preview?.reasons ?? null);
  const reasons = preview?.reasons ?? null;
  const pair = cards.length === 2;
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

  function tableRows(was: Game, next: Game): Row[] {
    const a = folderFacts(was);
    const b = folderFacts(next);
    return [
      { label: "Версия", was: was.versionInstalled ?? "—", next: next.versionInstalled ?? "—", same: false },
      {
        label: "Папка",
        was: a.onDisk ? (was.folderName ?? "—") : "нет на диске",
        next: b.onDisk ? (next.folderName ?? "—") : "нет на диске",
        same: reasons?.name ?? false,
        mono: true,
      },
      { label: "Размер", was: a.size, next: b.size, same: false },
      { label: "Изменена", was: a.changed, next: b.changed, same: false },
      { label: "Движок", was: was.engine ?? "—", next: next.engine ?? "—", same: Boolean(reasons?.engine) },
      { label: "exe", was: exeLabel(was), next: exeLabel(next), same: Boolean(reasons?.exe), mono: true },
      { label: "Сохранения", was: a.saves, next: b.saves, same: false },
      { label: "Страница", was: pageLabel(was), next: pageLabel(next), same: Boolean(reasons?.page) },
      { label: "Оценка", was: ratingLabel(was), next: ratingLabel(next), same: false },
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

  const was = pair ? cards.find((game) => game.id !== keptId) ?? cards[0] : undefined;
  const next = pair ? cards.find((game) => game.id === keptId) ?? cards[1] : undefined;
  const newestFirst = [...cards].reverse();
  const choices = newestFirst.filter((game) => folders.has(game.id));

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
          {chips.length > 0 ? (
            <ul className="game-merge-reasons" aria-label="Что совпало">
              {chips.map((chip) => (
                <li key={chip} className="game-merge-reason">
                  <Icon name="check" />
                  {chip}
                </li>
              ))}
            </ul>
          ) : (
            <p className="game-merge-noreason">
              {reasons ? "Каждая папка совпала с другими по своему признаку." : "Совпадений не нашлось — проверьте, что это одна игра."}
            </p>
          )}

          {pair && was && next ? (
            <div className="game-merge-table-pocket">
              <table className="game-merge-table">
                <colgroup>
                  <col className="game-merge-col-label" />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <td />
                    <th scope="col">
                      <span className="game-merge-th">
                        <GamePlate game={was} className="game-merge-avatar" />
                        <span className="game-merge-th-text">Было</span>
                      </span>
                    </th>
                    <th scope="col">
                      <span className="game-merge-th">
                        <GamePlate game={next} className="game-merge-avatar" />
                        <span className="game-merge-th-text">Станет</span>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows(was, next).map((row) => (
                    <tr key={row.label} className={row.same ? "same" : undefined}>
                      <th scope="row">
                        <span className="game-merge-label">
                          {row.same ? <Icon name="check" /> : null}
                          {row.label}
                        </span>
                      </th>
                      <td>
                        <span className={"game-merge-value" + (row.mono ? " mono" : "")} title={row.was}>
                          {row.was}
                        </span>
                      </td>
                      <td>
                        <span className={"game-merge-value next" + (row.mono ? " mono" : "")} title={row.next}>
                          {row.next}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
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
          )}

          {pair && choices.length >= 2 ? (
            <div className="game-merge-keep">
              <span className="game-merge-keep-label" id={`${titleId}-keep`}>
                Какая папка останется
              </span>
              <div className="game-merge-seg" role="radiogroup" aria-labelledby={`${titleId}-keep`} onKeyDown={listKeys}>
                {choices.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    role="radio"
                    data-id={game.id}
                    aria-checked={game.id === keptId}
                    tabIndex={game.id === keptId ? 0 : -1}
                    onClick={() => setKeptId(game.id)}
                  >
                    {keepLabel(game)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <p className="game-merge-consequence">
            {leavingLine(leaving)} {DATA_LINE}
          </p>
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
          Разные игры
        </button>
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" disabled={!ready || busy}>
          {kept ? mergeVerb(kept, cards.length, leaving.length) : "Обновить"}
          <SubmitMark />
        </button>
      </div>
    </form>
  );
}
