import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type { CSSProperties, FormEvent } from "react";

import { gameSetPage } from "../lib/api";
import { formatSize, STATUS_LABELS } from "../lib/gameFormat";
import { isArchivePath, pageUrlProblem, sourceName } from "../lib/gameImport";
import { gamesSnapshot, loadGames, subscribeGames } from "../lib/gamesStore";
import { askPageLater, dismissImport, forgetPageAsk, importState, subscribeImport } from "../lib/importJob";
import type { ImportJob } from "../lib/importJob";
import type { Game } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { Icon } from "./Icon";

function useGames(): Game[] | null {
  const [games, setGames] = useState<Game[] | null>(() => gamesSnapshot()?.games ?? null);
  useEffect(() => subscribeGames((library) => setGames(library.games)), []);
  return games;
}

function JobPocket({ job, games }: { job: ImportJob; games: Game[] }) {
  const name = sourceName(job.path);

  if (job.phase === "done") {
    const game = games.find((item) => item.id === job.id);
    return (
      <div className="import-pocket" role="status">
        <span className="import-pocket-lead ok" aria-hidden="true">
          <Icon name="check" />
        </span>
        <span className="import-pocket-text">
          <b>{game?.title ?? name}</b>
          <small>{game ? `В «${STATUS_LABELS[game.status]}»` : "Готово"}</small>
        </span>
      </div>
    );
  }

  if (job.phase === "error") {
    return (
      <div className="import-pocket" role="alert">
        <span className="import-pocket-lead danger" aria-hidden="true">
          <Icon name="alert" />
        </span>
        <span className="import-pocket-text">
          <b>{name}</b>
          <small className="wrap">{job.error}</small>
        </span>
        <button type="button" className="import-pocket-x" aria-label="Закрыть" title="Закрыть" onClick={dismissImport}>
          <Icon name="close" />
        </button>
      </div>
    );
  }

  const zip = isArchivePath(job.path);
  const percent = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const text = job.total > 0 ? `${formatSize(job.done)} из ${formatSize(job.total)}` : zip ? "Распаковывается…" : "Переносится…";
  return (
    <div className="import-pocket filling" style={{ "--p": `${percent}%` } as CSSProperties}>
      <span className="import-pocket-lead" aria-hidden="true">
        <Icon name="file" />
      </span>
      <span
        className="import-pocket-text"
        role="progressbar"
        aria-label={zip ? `Распаковка ${name}` : `Перенос ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={job.total > 0 ? percent : undefined}
      >
        <b>{name}</b>
        <small>{text}</small>
      </span>
      <button type="button" className="import-pocket-x" aria-label="Отменить" title="Отменить" onClick={dismissImport}>
        <Icon name="close" />
      </button>
    </div>
  );
}

function PagePocket({ game }: { game: Game }) {
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = url.trim();
    const issue = text === "" ? "Вставьте ссылку на страницу игры." : pageUrlProblem(text);
    setProblem(issue);
    if (issue) return;
    setSaving(true);
    try {
      await gameSetPage(game.id, text);
      await loadGames();
      forgetPageAsk(game.id);
    } catch (err) {
      setProblem(userMessage(err));
      setSaving(false);
    }
  }

  return (
    <form className="import-pocket page" noValidate onSubmit={submit}>
      <label className="import-pocket-text" htmlFor={inputId}>
        <b>{game.title}</b>
        <small>Ссылка на страницу игры</small>
      </label>
      <span className="import-pocket-field">
        <input
          id={inputId}
          type="url"
          value={url}
          placeholder="https://f95zone.to/threads/…"
          disabled={saving}
          onChange={(e) => {
            setUrl(e.target.value);
            setProblem(null);
          }}
        />
        <button type="submit" className="import-pocket-add" disabled={saving}>
          Добавить
        </button>
      </span>
      {problem ? <small className="import-pocket-problem">{problem}</small> : null}
      <span className="import-pocket-acts">
        <button type="button" className="import-pocket-quiet" disabled={saving} onClick={() => askPageLater(game.id)}>
          Потом
        </button>
        <button type="button" className="import-pocket-quiet" disabled={saving} onClick={() => forgetPageAsk(game.id)}>
          Без ссылки
        </button>
      </span>
    </form>
  );
}

export function ImportPocket() {
  const { job, pageAsk, later } = useSyncExternalStore(subscribeImport, importState);
  const games = useGames();

  useEffect(() => {
    if (!games) return;
    pageAsk
      .filter((id) => !games.some((game) => game.id === id && game.pageUrl === null))
      .forEach(forgetPageAsk);
  }, [games, pageAsk]);

  if (job) return <JobPocket job={job} games={games ?? []} />;
  const asked = pageAsk
    .filter((id) => !later.includes(id))
    .map((id) => games?.find((game) => game.id === id && game.pageUrl === null))
    .find((game): game is Game => game !== undefined);
  return asked ? <PagePocket key={asked.id} game={asked} /> : null;
}
