import { useEffect, useState } from "react";

import { tagRemoveFromGames, tagRename, tagUsage } from "../lib/api";
import type { TagRow } from "../lib/gameTags";
import { pluralizeRu } from "../lib/pluralizeRu";
import { userMessage } from "../lib/userMessage";
import { DialogHead, DialogPocket } from "./DialogHead";
import { Icon } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

interface GameTagDictionaryProps {
  titleId: string;
  rows: TagRow[];
  own: Map<string, number>;
  onClose: () => void;
}

type Mode = { name: string; kind: "rename" | "merge" | "delete" };

const FORUM_HINT = "Тег с форума — изменить нельзя, он придёт снова";

export function GameTagDictionary({ titleId, rows, own, onClose }: GameTagDictionaryProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkTags, setBookmarkTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    tagUsage()
      .then((usage) => {
        if (live) setBookmarkTags(new Set(usage.filter((tag) => tag.bookmarks > 0).map((tag) => tag.name)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ru"));

  function open(next: Mode) {
    setMode(next);
    setDraft(next.name);
    setTarget("");
    setError(null);
  }

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode(null);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent, row: TagRow) {
    e.preventDefault();
    if (!mode) return;
    if (mode.kind === "rename") {
      const next = draft.trim();
      if (next === "" || next === row.name) {
        setMode(null);
        return;
      }
      void run(() => tagRename(row.name, next));
    } else if (mode.kind === "merge") {
      if (target === "") return;
      void run(() => tagRename(row.name, target));
    } else {
      void run(() => tagRemoveFromGames(row.name));
    }
  }

  return (
    <div className="dialog gtag-dict">
      <DialogHead id={titleId} title="Словарь тегов" onClose={onClose} />
      <div className="dialog-body">
        <DialogPocket className="gtag-dict-pocket">
          <div className="gtag-dict-head" aria-hidden="true">
            <span className="gtag-dict-name">Тег</span>
            <span className="gtag-dict-src">Источник</span>
            <span className="gtag-dict-n">Игр</span>
            <span className="gtag-dict-acts" />
          </div>
          <ul className="gtag-dict-list">
            {sorted.map((row) => {
              const active = mode?.name === row.name ? mode : null;
              const mine = own.get(row.name) ?? 0;
              const others = sorted.filter((item) => item.name !== row.name);
              return (
                <li key={row.name} className="gtag-dict-item">
                  <div className="gtag-dict-row">
                    <span className={"gtag-dict-name" + (row.forum ? " forum" : "")}>{row.name}</span>
                    <span className="gtag-dict-src">
                      {row.forum ? (
                        <>
                          <Icon name="globe" className="gtag-globe" />С форума
                        </>
                      ) : (
                        "Мой"
                      )}
                    </span>
                    <span className="gtag-dict-n">{row.count}</span>
                    <span className="gtag-dict-acts">
                      <button
                        type="button"
                        className="gtag-act"
                        aria-label={`Переименовать «${row.name}»`}
                        title={row.forum ? FORUM_HINT : undefined}
                        aria-disabled={row.forum || undefined}
                        onClick={() => !row.forum && open({ name: row.name, kind: "rename" })}
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        type="button"
                        className="gtag-act"
                        aria-label={`Объединить «${row.name}» с…`}
                        title={row.forum ? FORUM_HINT : "Объединить с…"}
                        aria-disabled={row.forum || undefined}
                        onClick={() => !row.forum && open({ name: row.name, kind: "merge" })}
                      >
                        <Icon name="versions" />
                      </button>
                      <button
                        type="button"
                        className="gtag-act"
                        aria-label={`Удалить «${row.name}»`}
                        title={mine === 0 ? FORUM_HINT : undefined}
                        aria-disabled={mine === 0 || undefined}
                        onClick={() => mine > 0 && open({ name: row.name, kind: "delete" })}
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </div>
                  {active ? (
                    <form className="gtag-dict-edit" onSubmit={(e) => submit(e, row)}>
                      {active.kind === "rename" ? (
                        <input
                          autoFocus
                          aria-label="Новое имя тега"
                          value={draft}
                          maxLength={40}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                      ) : active.kind === "merge" ? (
                        <select
                          autoFocus
                          aria-label="Объединить с"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="">Объединить с…</option>
                          {others.map((item) => (
                            <option key={item.name} value={item.name}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="gtag-dict-ask">
                          Удалить тег у {mine} {pluralizeRu(mine, ["игры", "игр", "игр"])}?
                        </span>
                      )}
                      <button type="submit" className="gtag-dict-ok" disabled={busy}>
                        {active.kind === "rename" ? "Переименовать" : active.kind === "merge" ? "Объединить" : "Удалить"}
                      </button>
                      <button type="button" className="gtag-dict-cancel" onClick={() => setMode(null)}>
                        Отмена
                      </button>
                    </form>
                  ) : null}
                  {active?.kind === "rename" && bookmarkTags.has(row.name) ? (
                    <p className="gtag-dict-warn">Тег есть и у закладок — переименуется везде</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </DialogPocket>
        {error ? (
          <ShowcaseNote icon="alert" className="games-note-danger">
            {error}
          </ShowcaseNote>
        ) : null}
      </div>
    </div>
  );
}
