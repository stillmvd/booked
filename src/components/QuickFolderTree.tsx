import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { folderPathNames, matchFolders, splitMatch } from "../lib/recentFolders";
import type { FolderChoice } from "../lib/recentFolders";
import type { FolderRef } from "../lib/types";
import { Icon } from "./Icon";

interface QuickFolderTreeProps {
  refs: FolderRef[];
  selected: FolderChoice;
  labelId: string;
  onSelect: (id: FolderChoice) => void;
  onCreate: (name: string, parentId: FolderChoice) => Promise<void>;
}

interface Draft {
  parentId: FolderChoice;
  name: string;
  failed: boolean;
  busy: boolean;
}

type FocusWish = "first" | "checked" | { id: FolderChoice };

export function QuickFolderTree({ refs, selected, labelId, onSelect, onCreate }: QuickFolderTreeProps) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusWish = useRef<FocusWish | null>(null);

  const byId = useMemo(() => new Map(refs.map((ref) => [ref.id, ref])), [refs]);
  const kids = useMemo(() => {
    const map = new Map<FolderChoice, FolderRef[]>();
    for (const ref of refs) {
      const list = map.get(ref.parentId);
      if (list) list.push(ref);
      else map.set(ref.parentId, [ref]);
    }
    return map;
  }, [refs]);

  const hits = matchFolders(refs, query);
  const selectedRef = selected === null ? null : (byId.get(selected) ?? null);
  const nameOf = (id: FolderChoice) => (id === null ? "Booked" : (byId.get(id)?.name ?? ""));
  const tabbable: FolderChoice =
    query && hits.length > 0 && !hits.some((ref) => ref.id === selected) ? hits[0].id : selected;

  useEffect(() => {
    const wish = focusWish.current;
    if (!wish) return;
    focusWish.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>(".quick-tree-row");
    const target =
      wish === "first"
        ? rows?.[0]
        : listRef.current?.querySelector<HTMLElement>(
            wish === "checked" ? '.quick-tree-row[aria-checked="true"]' : `.quick-tree-row[data-id="${wish.id ?? "root"}"]`,
          );
    target?.focus();
  });

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('.quick-tree-row[aria-checked="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, refs]);

  function pick(id: FolderChoice) {
    onSelect(id);
    if (query) {
      setQuery("");
      focusWish.current = { id };
    }
  }

  function openDraft(parentId: FolderChoice, name = "") {
    setQuery("");
    setDraft({ parentId, name, failed: false, busy: false });
  }

  function closeDraft() {
    if (!draft) return;
    focusWish.current = { id: draft.parentId };
    setDraft(null);
  }

  async function submitDraft() {
    if (!draft || draft.busy) return;
    const name = draft.name.trim();
    if (!name) return;
    setDraft((d) => d && { ...d, busy: true, failed: false });
    try {
      await onCreate(name, draft.parentId);
      setDraft(null);
      focusWish.current = "checked";
    } catch (err) {
      console.error(err);
      setDraft((d) => d && { ...d, busy: false, failed: true });
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest(".quick-tree-new")) return;
    const item = target.closest(".quick-tree-item");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".quick-tree-row") ?? [])];
      const row = item?.querySelector<HTMLElement>(".quick-tree-row");
      const index = row ? rows.indexOf(row) : -1;
      if (index < 0) return;
      e.preventDefault();
      rows[index + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = item?.querySelector<HTMLElement>(e.key === "ArrowRight" ? ".quick-tree-plus" : ".quick-tree-row");
      if (next && next !== target) {
        e.preventDefault();
        next.focus();
      }
      return;
    }
    if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
      focusWish.current = { id: selected };
      return;
    }
    if (e.key === "Backspace" && query) {
      e.preventDefault();
      setQuery(query.slice(0, -1));
      focusWish.current = query.length > 1 ? "first" : { id: selected };
      return;
    }
    const chord = (e.ctrlKey || e.altKey || e.metaKey) && !e.getModifierState("AltGraph");
    if (chord || e.key.length !== 1 || (e.key === " " && !query)) return;
    e.preventDefault();
    setQuery(query + e.key);
    focusWish.current = "first";
  }

  function row(ref: FolderRef | null, opts: { prefix?: string; plusName?: string; plusShown?: boolean } = {}) {
    const id = ref?.id ?? null;
    const name = nameOf(id);
    const [before, match, after] = splitMatch(name, query);
    const plusLabel = `Новая подпапка в «${name}»`;
    return (
      <div className={"quick-tree-item" + (opts.plusShown ? " quick-tree-item-plus" : "")}>
        <button
          type="button"
          role="radio"
          aria-checked={id === selected}
          tabIndex={id === tabbable ? 0 : -1}
          className="quick-tree-row"
          data-id={id ?? "root"}
          onClick={() => pick(id)}
        >
          <span className="quick-tree-radio" aria-hidden="true" />
          <span className="quick-tree-name">
            {opts.prefix ? <span className="quick-tree-prefix">{opts.prefix} ›</span> : null}
            {before}
            {match ? <b>{match}</b> : null}
            {after}
          </span>
        </button>
        <button
          type="button"
          className="quick-tree-plus"
          tabIndex={-1}
          aria-label={plusLabel}
          title={plusLabel}
          onClick={() => openDraft(id, opts.plusName)}
        >
          <Icon name="plus" />
        </button>
      </div>
    );
  }

  const draftRow = draft ? (
    <div
      className="quick-tree-new"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeDraft();
        }
      }}
    >
      <div className="quick-tree-new-row">
        <input
          className="quick-tree-new-input"
          value={draft.name}
          placeholder="Новая папка"
          aria-label="Имя новой папки"
          autoFocus
          onChange={(e) => {
            const name = e.target.value;
            setDraft((d) => d && { ...d, name, failed: false });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitDraft();
            }
          }}
        />
        <button
          type="button"
          className="quick-tree-ok"
          aria-label="Создать папку"
          title="Создать папку"
          disabled={!draft.name.trim() || draft.busy}
          onClick={submitDraft}
        >
          <Icon name="check" />
        </button>
        <button type="button" className="quick-tree-cancel" aria-label="Не создавать" title="Не создавать" onClick={closeDraft}>
          <Icon name="close" />
        </button>
      </div>
      <span className={"quick-tree-caption" + (draft.failed ? " quick-tree-caption-error" : "")} role={draft.failed ? "alert" : undefined}>
        {draft.failed ? "Не удалось создать папку" : `Создастся в ${nameOf(draft.parentId)}`}
      </span>
    </div>
  ) : null;

  function branch(parentId: number): ReactNode {
    const list = kids.get(parentId) ?? [];
    const input = draft?.parentId === parentId ? draftRow : null;
    if (list.length === 0 && !input) return null;
    return (
      <div className="quick-tree-kids" role="group">
        {input}
        {list.map((ref) => (
          <Fragment key={ref.id}>
            {row(ref)}
            {branch(ref.id)}
          </Fragment>
        ))}
      </div>
    );
  }

  const tree = (
    <>
      {row(null)}
      {draft?.parentId === null ? <div className="quick-tree-kids">{draftRow}</div> : null}
      {(kids.get(null) ?? []).map((ref) => (
        <Fragment key={ref.id}>
          {row(ref)}
          {branch(ref.id)}
        </Fragment>
      ))}
    </>
  );

  const results =
    hits.length > 0 ? (
      hits.map((ref) => (
        <Fragment key={ref.id}>{row(ref, { prefix: folderPathNames(refs, ref.parentId).join(" › ") })}</Fragment>
      ))
    ) : (
      <>
        <p className="quick-tree-empty">Ничего не найдено</p>
        {row(selectedRef, { plusName: query, plusShown: true })}
        <span className="quick-tree-caption">Плюс создаёт подпапку в «{nameOf(selected)}»</span>
      </>
    );

  return (
    <div className="quick-tree-block" onKeyDown={handleKeyDown}>
      <div role="status">
        {query ? (
          <span className="quick-tree-query">
            <Icon name="search" />
            {query}
            <span className="quick-tree-caret" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="quick-tree" role="radiogroup" aria-labelledby={labelId} ref={listRef}>
        {query ? results : tree}
      </div>
    </div>
  );
}
