import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import {
  gameRefreshCover,
  gameSetCoverPos,
  gameSetImage,
  gameSetNote,
  gameSetTags,
  gameSetTitle,
  gameSetVersion,
  gameUpdates,
  imageImport,
  imageImportBytes,
  imageImportUrl,
  mediaPath,
  setGameStoppedAt,
} from "../lib/api";
import { coverStyle } from "../lib/coverFrame";
import { finishedLabel, playTimeFull } from "../lib/gameFields";
import { MANUAL_STATUS_GROUPS, showsUpdateMark, STATUS_LABELS, updateDay, updateLabel } from "../lib/gameFormat";
import { NOTE_LIMIT, withoutGame } from "../lib/gameTags";
import type { TagRow } from "../lib/gameTags";
import type { ImagePick } from "../lib/imageSource";
import type { Game, GameStatus, GameUpdate } from "../lib/types";
import { usePendingImage } from "../lib/usePendingImage";
import { CoverFrame } from "./CoverFrame";
import { SubmitMark } from "./DialogHead";
import { DownloadButton } from "./DownloadLinks";
import { GameTagPicker } from "./GameTagPicker";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

interface GamePanelProps {
  game: Game;
  catalog: TagRow[];
  busy: boolean;
  pendingImage?: ImagePick;
  onStatus: (status: GameStatus) => void;
  onSave: (url: string | null) => void;
  onOpen: () => void;
  onSkip: () => void;
  onClose: () => void;
  onDownload: () => void;
  onUnpack?: () => void;
  onChanged: () => void;
  onError: (err: unknown) => void;
}

interface PanelFieldProps {
  icon: IconName;
  label: string;
  value: string;
  max?: number;
  multiline?: boolean;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
  action?: ReactNode;
  onCommit: (value: string) => void;
}

function PanelField({ icon, label, value, max, multiline, disabled, type, placeholder, action, onCommit }: PanelFieldProps) {
  const [draft, setDraft] = useState(value);
  const skip = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (skip.current) {
      skip.current = false;
      return;
    }
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
    else setDraft(value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      skip.current = true;
      setDraft(value);
      e.currentTarget.blur();
    } else if (e.key === "Enter" && (!multiline || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  const shared = {
    value: draft,
    maxLength: max,
    disabled,
    "aria-label": label,
    placeholder: placeholder ?? label,
    onBlur: commit,
    onKeyDown,
  };

  return (
    <label className={"gwin-field" + (multiline ? " multi" : "") + (action ? " acted" : "")}>
      <Icon name={icon} />
      {multiline ? (
        <textarea {...shared} rows={1} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input {...shared} type={type ?? "text"} onChange={(e) => setDraft(e.target.value)} />
      )}
      {action ?? (
        <span className="gwin-pen" aria-hidden="true">
          <Icon name="edit" />
        </span>
      )}
    </label>
  );
}

export function GamePanel({
  game,
  catalog,
  busy,
  pendingImage,
  onStatus,
  onSave,
  onOpen,
  onSkip,
  onClose,
  onDownload,
  onUnpack,
  onChanged,
  onError,
}: GamePanelProps) {
  const baseId = useId();
  const wish = game.status === "wish";
  const [history, setHistory] = useState<GameUpdate[]>([]);
  const [title, setTitle] = useState(game.title);
  const [version, setVersion] = useState(game.versionInstalled ?? "");
  const savedMine = useMemo(() => game.tags.filter((tag) => !game.forumTags.includes(tag)), [game.tags, game.forumTags]);
  const [tags, setTags] = useState(savedMine);
  const ownCatalog = useMemo(() => withoutGame(catalog, game.tags), [catalog, game.tags]);
  const [working, setWorking] = useState(false);
  const [framing, setFraming] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: game.imageX, y: game.imageY, zoom: game.imageZoom });

  useEffect(() => {
    setTitle(game.title);
  }, [game.id, game.title]);

  useEffect(() => {
    setVersion(game.versionInstalled ?? "");
  }, [game.id, game.versionInstalled]);

  useEffect(() => {
    setTags(savedMine);
  }, [game.id, savedMine]);

  useEffect(() => {
    setFraming(false);
  }, [game.id, game.image]);

  useEffect(() => {
    setPos({ x: game.imageX, y: game.imageY, zoom: game.imageZoom });
  }, [game.id, game.imageX, game.imageY, game.imageZoom]);

  useEffect(() => {
    if (!framing) return;
    function leave(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setFraming(false);
      setPos({ x: game.imageX, y: game.imageY, zoom: game.imageZoom });
    }
    document.addEventListener("keydown", leave, true);
    return () => document.removeEventListener("keydown", leave, true);
  }, [framing, game.imageX, game.imageY, game.imageZoom]);

  useEffect(() => {
    let alive = true;
    gameUpdates(game.id)
      .then((list) => alive && setHistory(list))
      .catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [game.id, game.versionInstalled]);

  useEffect(() => {
    if (!game.image) {
      setImageSrc(null);
      return;
    }
    let alive = true;
    mediaPath(["images", game.image]).then((full) => {
      if (alive) setImageSrc(convertFileSrc(full));
    });
    return () => {
      alive = false;
    };
  }, [game.image]);

  async function apply(job: () => Promise<unknown>, rollback?: () => void) {
    try {
      await job();
    } catch (err) {
      rollback?.();
      onError(err);
    }
    onChanged();
  }

  async function setCover(file: string | null) {
    if (file === game.image) return;
    await gameSetImage(game.id, file);
    await gameSetCoverPos(game.id, 50, 50, 1);
  }

  async function cover(job: () => Promise<string | null>) {
    setWorking(true);
    await apply(async () => setCover(await job()));
    setWorking(false);
  }

  async function pickCover() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Изображение", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    void cover(() => imageImport(picked));
  }

  async function coverFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    void cover(() => imageImportBytes(bytes));
  }

  async function coverUrl(url: string) {
    void cover(() => imageImportUrl(url));
  }

  usePendingImage(pendingImage, coverFile, coverUrl);

  function saveTitle() {
    const next = title.trim();
    if (next === "" || next === game.title) {
      setTitle(game.title);
      return;
    }
    void apply(() => gameSetTitle(game.id, next), () => setTitle(game.title));
  }

  function saveVersion() {
    const next = version.trim() === "" ? null : version.trim();
    if (next === game.versionInstalled) {
      setVersion(game.versionInstalled ?? "");
      return;
    }
    void apply(() => gameSetVersion(game.id, next), () => setVersion(game.versionInstalled ?? ""));
  }

  function saveTags(next: string[]) {
    setTags(next);
    void apply(() => gameSetTags(game.id, next), () => setTags(savedMine));
  }

  function headKey(e: React.KeyboardEvent<HTMLInputElement>, reset: () => void) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      reset();
      const input = e.currentTarget;
      requestAnimationFrame(() => input.blur());
    }
  }

  const badge = showsUpdateMark(game) ? updateLabel(game.source, game.siteVersion, game.versionInstalled) : "";
  const untracked = game.pageUrl !== null && game.source === null;
  const openable = /^https?:\/\/\S/i.test(game.pageUrl ?? "");
  const canDownload = (game.downloadLinks.length > 0 || openable) && (wish || game.hasUpdate);
  const canUnpack = wish && game.folderPath === null && onUnpack !== undefined;
  const facts = !wish && (game.playSecs > 0 || (game.status === "finished" && game.finishedAt !== null));
  const sideBox = Boolean(badge) || canDownload || canUnpack || !wish || game.hasUpdate;

  return (
    <section className="game-panel gwin" aria-label={game.title}>
      <div className="gwin-left">
        <div className="gwin-card">
          {framing && imageSrc ? (
            <div className="gwin-frame">
              <CoverFrame
                src={imageSrc}
                x={pos.x}
                y={pos.y}
                zoom={pos.zoom}
                onChange={(x, y, zoom) => setPos({ x, y, zoom })}
                actions={
                  <button
                    type="button"
                    className="cover-frame-done"
                    onClick={() => {
                      setFraming(false);
                      if (pos.x !== game.imageX || pos.y !== game.imageY || pos.zoom !== game.imageZoom) {
                        void apply(() => gameSetCoverPos(game.id, pos.x, pos.y, pos.zoom));
                      }
                    }}
                  >
                    Сохранить
                    <SubmitMark />
                  </button>
                }
              />
            </div>
          ) : (
            <>
              <span className={"gwin-cover" + (imageSrc ? "" : " letter")}>
                {imageSrc ? (
                  <img src={imageSrc} alt="" draggable={false} style={coverStyle(pos.x, pos.y, pos.zoom)} />
                ) : (
                  <span className="game-cover-letter" aria-hidden="true">
                    {game.title.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
              </span>
              <div className="gwin-cover-acts" role="group" aria-label="Обложка">
                <button type="button" aria-label="Выбрать обложку" title="Выбрать обложку" disabled={working} onClick={() => void pickCover()}>
                  <Icon name="image-plus" />
                </button>
                {game.pageUrl ? (
                  <button
                    type="button"
                    aria-label="Обновить обложку с сайта"
                    title="Обновить обложку с сайта"
                    disabled={working}
                    onClick={() => void cover(() => gameRefreshCover(game.id).then((file) => file ?? game.image))}
                  >
                    <Icon name="reset" />
                  </button>
                ) : null}
                {game.image ? (
                  <>
                    <button type="button" aria-label="Кадрировать обложку" title="Кадрировать" disabled={working} onClick={() => setFraming(true)}>
                      <Icon name="crop" />
                    </button>
                    <button type="button" aria-label="Убрать обложку" title="Убрать обложку" disabled={working} onClick={() => void cover(async () => null)}>
                      <Icon name="trash" />
                    </button>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>

        {sideBox ? (
          <div className="gwin-side">
            {badge ? <p className="game-panel-update">{badge}</p> : null}

            {canDownload ? <DownloadButton version={game.siteVersion} onOpen={onDownload} /> : null}

            {canUnpack ? (
              <button type="button" className="game-panel-unpack" disabled={busy} onClick={onUnpack}>
                <Icon name="download" />
                Распаковать архив…
              </button>
            ) : null}

            {wish ? null : (
              <div className="game-panel-statuses" role="group" aria-label="Статус игры">
                {MANUAL_STATUS_GROUPS.map((group) => (
                  <div key={group[0]} className="game-panel-status-group">
                    {group.map((status) => (
                      <button key={status} type="button" aria-pressed={game.status === status} onClick={() => onStatus(status)}>
                        {STATUS_LABELS[status]}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {facts ? (
              <dl className="gfl-facts">
                {game.status === "finished" && game.finishedAt !== null ? (
                  <div>
                    <dt>Пройдена</dt>
                    <dd>{finishedLabel(game.finishedAt)}</dd>
                  </div>
                ) : null}
                {game.playSecs > 0 ? (
                  <div>
                    <dt>Время в игре</dt>
                    <dd>{playTimeFull(game.playSecs)}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}

            {game.hasUpdate ? (
              <button type="button" className="game-panel-skip" disabled={busy} onClick={onSkip}>
                Пропустить эту версию
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="gwin-main">
        <div className="gwin-head">
          <input
            className="gwin-title"
            aria-label="Название"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => headKey(e, () => setTitle(game.title))}
          />
          <input
            className="gwin-version"
            aria-label="Версия"
            title="Версия"
            placeholder="не определена"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            onBlur={saveVersion}
            onKeyDown={(e) => headKey(e, () => setVersion(game.versionInstalled ?? ""))}
          />
          <button type="button" className="game-panel-close" aria-label="Закрыть окно игры" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <PanelField
          icon="text"
          label="Заметка"
          value={game.note}
          max={NOTE_LIMIT}
          multiline
          onCommit={(next) => void apply(() => gameSetNote(game.id, next))}
        />

        <PanelField
          icon="bookmark"
          label="Где остановился"
          value={game.stoppedAt ?? ""}
          max={200}
          onCommit={(next) => void apply(() => setGameStoppedAt(game.id, next))}
        />

        <GameTagPicker catalog={ownCatalog} mine={tags} forum={game.forumTags} onChange={saveTags} />

        {wish ? null : (
          <>
            <PanelField
              icon="link"
              label="Страница игры"
              type="url"
              value={game.pageUrl ?? ""}
              disabled={busy}
              onCommit={(next) => onSave(next === "" ? null : next)}
              action={
                openable ? (
                  <button
                    type="button"
                    className="game-panel-open"
                    aria-label="Открыть страницу"
                    title="Открыть страницу"
                    disabled={busy}
                    onClick={onOpen}
                  >
                    <Icon name="arrow-up-right" />
                  </button>
                ) : undefined
              }
            />
            {untracked ? <p className="game-panel-note">Отслеживание работает только для F95zone и itch.io</p> : null}
          </>
        )}

        {history.length > 0 ? (
          <div className="game-panel-history">
            <p className="game-panel-label" id={`${baseId}-history`}>
              История обновлений
            </p>
            <ol className="gwin-history" aria-labelledby={`${baseId}-history`}>
              {history.map((update) => (
                <li key={update.id}>
                  <b>{updateDay(update.at)}</b>
                  <span className="game-history-step">
                    {update.fromVersion}
                    <Icon name="arrow-right" />
                    {update.toVersion}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}
