import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";

import { tagCreate, tagDelete, tagDeleteUnused, tagRename, tagTarget, tagToggle, tagUsage } from "../lib/api";
import { tint } from "../lib/plate";
import { readStored, writeStored } from "../lib/storage";
import {
  filterTags,
  findTag,
  mergeInto,
  mergeText,
  normalizeTag,
  sortTags,
  TAG_SORT_KEY,
  targetWord,
  usageFrom,
  usageText,
  usageTotal,
} from "../lib/tagEditor";
import type { TagSort } from "../lib/tagEditor";
import type { ResolvedTheme } from "../lib/theme";
import type { TagTarget, TagUsage } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { DialogHead, SubmitMark } from "./DialogHead";
import { Icon } from "./Icon";

export interface TagEditorCard {
  target: TagTarget;
  title: string;
}

interface TagEditorDialogProps {
  titleId: string;
  card: TagEditorCard | null;
  theme: ResolvedTheme;
  onClose: () => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (names: string[]) => void;
}

const CARD_GONE = "Карточки уже нет";

function neighbour<T extends string | { name: string }>(items: T[], name: string): string {
  const names = items.map((item) => (typeof item === "string" ? item : item.name));
  const at = names.indexOf(name);
  return names[at + 1] ?? names[at - 1] ?? "";
}
const CHIP_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];

export function TagEditorDialog({ titleId, card, theme, onClose, onRenamed, onDeleted }: TagEditorDialogProps) {
  const [tags, setTags] = useState<TagUsage[] | null>(null);
  const [marks, setMarks] = useState<string[]>([]);
  const [cardGone, setCardGone] = useState(false);
  const [editing, setEditing] = useState(card === null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TagSort>(() => (readStored<string>(TAG_SORT_KEY, "frequency") === "alpha" ? "alpha" : "frequency"));
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<TagUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const cardGoneRef = useRef(false);
  const focusRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const cardMode = card !== null && !cardGone && !editing;
  const all = tags ?? [];
  const shown = sortTags(filterTags(all, query), sort);
  const exact = findTag(all, query);
  const canCreate = query.trim() !== "" && !exact;
  const markKeys = new Set(marks.map(normalizeTag));
  const selectedTag = selected === null ? undefined : findTag(all, selected);
  const draft = selectedTag && renaming && normalizeTag(renaming.from) === normalizeTag(selectedTag.name) ? renaming.value : null;
  const merge = selectedTag && draft !== null ? mergeInto(all, selectedTag.name, draft) : null;
  const words = card ? targetWord(card.target) : null;

  function fail(err: unknown) {
    const message = userMessage(err);
    if (message === CARD_GONE && card) {
      cardGoneRef.current = true;
      setCardGone(true);
      setError("Карточки больше нет — остался общий список тегов");
      return;
    }
    setError(message);
  }

  async function load() {
    setTags(await tagUsage());
    if (card && !cardGoneRef.current) setMarks(await tagTarget(card.target));
  }

  async function act(job: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      await job();
    } catch (err) {
      fail(err);
    }
    try {
      await load();
    } catch (err) {
      fail(err);
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    load().catch(fail);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const name = focusRef.current;
    if (name === null) return;
    const chip = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-tag], [data-mark]") ?? []).find(
      (el) => (el.dataset.tag ?? el.dataset.mark) === name,
    );
    if (!chip && busyRef.current) return;
    focusRef.current = null;
    (chip ?? searchRef.current)?.focus();
  }, [tags, marks, removing, renaming]);

  function chipStyle(name: string): CSSProperties {
    const { bg, fg } = tint(name, theme);
    return { "--tag-bg": bg, "--tag-fg": fg } as CSSProperties;
  }

  function changeSort(next: TagSort) {
    setSort(next);
    writeStored(TAG_SORT_KEY, next);
  }

  function select(name: string) {
    setRenaming(null);
    setSelected((prev) => (prev !== null && normalizeTag(prev) === normalizeTag(name) ? null : name));
  }

  function toggle(name: string, on: boolean, next = "") {
    if (!card) return;
    focusRef.current = next;
    void act(async () => {
      setMarks(await tagToggle(card.target, name, on));
    });
  }

  function create() {
    const name = query.trim();
    if (!name) return;
    void act(async () => {
      if (cardMode && card) {
        setMarks(await tagToggle(card.target, name, true));
      } else {
        const created = await tagCreate(name);
        setRenaming(null);
        setSelected(created);
        focusRef.current = created;
      }
      setQuery("");
    });
  }

  function startRename(tag: TagUsage) {
    setSelected(tag.name);
    setRenaming({ from: tag.name, value: tag.name });
  }

  function cancelRename() {
    focusRef.current = selectedTag?.name ?? null;
    setRenaming(null);
  }

  function commitRename(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedTag || draft === null) return;
    const from = selectedTag.name;
    const to = draft;
    if (to.trim() === from) {
      cancelRename();
      return;
    }
    void act(async () => {
      const outcome = await tagRename(from, to);
      onRenamed(from, outcome.name);
      setSelected(outcome.name);
      setRenaming(null);
      focusRef.current = outcome.name;
    });
  }

  function askDelete(tag: TagUsage) {
    if (usageTotal(tag) === 0) remove(tag.name);
    else setRemoving(tag);
  }

  function remove(name: string) {
    void act(async () => {
      await tagDelete(name);
      onDeleted([name]);
      setSelected(null);
      setRenaming(null);
      setRemoving(null);
      focusRef.current = "";
    });
  }

  function cancelRemove() {
    focusRef.current = removing?.name ?? null;
    setRemoving(null);
  }

  function removeUnused() {
    const names = all.filter((tag) => usageTotal(tag) === 0).map((tag) => tag.name);
    void act(async () => {
      await tagDeleteUnused();
      onDeleted(names);
      setRenaming(null);
      if (selected !== null && names.some((name) => normalizeTag(name) === normalizeTag(selected))) setSelected(null);
      focusRef.current = "";
    });
  }

  function handleSearchKeys(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canCreate) create();
      else if (exact && cardMode && !markKeys.has(normalizeTag(exact.name))) toggle(exact.name, true);
      else if (exact && !cardMode) select(exact.name);
    } else if (e.key === "ArrowDown") {
      const first = listRef.current?.querySelector<HTMLElement>("[data-tag]");
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Escape" && query !== "") {
      e.stopPropagation();
      setQuery("");
    }
  }

  function handleListKeys(e: KeyboardEvent<HTMLDivElement>) {
    if (!CHIP_KEYS.includes(e.key)) return;
    const chips = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-tag]") ?? []);
    const at = chips.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const next = e.key === "Home" ? 0 : e.key === "End" ? chips.length - 1 : at + (forward ? 1 : -1);
    chips[Math.max(0, Math.min(chips.length - 1, next))]?.focus();
  }

  function handleChipKeys(e: KeyboardEvent<HTMLButtonElement>, tag: TagUsage) {
    if (e.key === "F2") {
      e.preventDefault();
      startRename(tag);
    } else if (e.key === "Delete") {
      e.preventDefault();
      setSelected(tag.name);
      askDelete(tag);
    }
  }

  function chip(tag: TagUsage, idle: boolean) {
    const total = usageTotal(tag);
    const pressed = !cardMode && selectedTag !== undefined && normalizeTag(selectedTag.name) === normalizeTag(tag.name);
    return (
      <button
        key={tag.name}
        type="button"
        data-tag={tag.name}
        className={idle ? "tag-editor-chip tag-editor-chip-idle" : "tag-editor-chip"}
        style={chipStyle(tag.name)}
        aria-pressed={cardMode ? undefined : pressed}
        aria-label={cardMode ? `Добавить «${tag.name}»` : undefined}
        onClick={() => (cardMode ? toggle(tag.name, true, neighbour(cloud, tag.name)) : select(tag.name))}
        onKeyDown={cardMode ? undefined : (e) => handleChipKeys(e, tag)}
      >
        <span className="tag-editor-chip-name">{tag.name}</span>
        {total > 0 && <span className="tag-editor-chip-n">{total}</span>}
      </button>
    );
  }

  function detail(tag: TagUsage) {
    return (
      <>
        <div className="tag-editor-detail">
          {draft === null ? (
            <>
              <div className="tag-editor-detail-text">
                <b>{tag.name}</b>
                <span>{usageText(tag)}</span>
              </div>
              <button type="button" className="tag-editor-link" onClick={() => startRename(tag)}>
                <Icon name="edit" />
                Переименовать
              </button>
              <button type="button" className="tag-editor-link tag-editor-link-danger" onClick={() => askDelete(tag)}>
                <Icon name="trash" />
                Удалить
              </button>
            </>
          ) : (
            <form className="tag-editor-rename" onSubmit={commitRename}>
              <input
                className="tag-editor-rename-input"
                aria-label={`Новое имя для «${tag.name}»`}
                value={draft}
                autoFocus
                spellCheck={false}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setRenaming({ from: tag.name, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    cancelRename();
                  }
                }}
              />
              <button
                type="submit"
                className="tag-editor-confirm"
                aria-label={merge ? `Объединить с «${merge.name}»` : "Переименовать"}
                title={merge ? "Объединить" : "Переименовать"}
              >
                <Icon name="check" />
              </button>
            </form>
          )}
        </div>
        {merge && (
          <p className="tag-editor-merge">
            <span className="tag-editor-merge-icon" aria-hidden="true">
              <Icon name="versions" />
            </span>
            <span>
              Объединится с <b>«{merge.name}»</b>: {mergeText(tag, merge)}
            </span>
          </p>
        )}
      </>
    );
  }

  const title = cardMode && words ? `Теги ${words.of}` : "Все теги";
  const cloud = cardMode ? shown.filter((tag) => !markKeys.has(normalizeTag(tag.name))) : shown;
  const used = cardMode ? cloud : cloud.filter((tag) => usageTotal(tag) > 0);
  const unused = cardMode ? [] : cloud.filter((tag) => usageTotal(tag) === 0);
  const nothing = tags !== null && used.length === 0 && unused.length === 0;

  return (
    <div
      ref={rootRef}
      className="dialog tag-editor"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !removing) return;
        e.stopPropagation();
        cancelRemove();
      }}
    >
      <DialogHead id={titleId} title={title} onClose={onClose} />
      {cardMode && card && <div className="tag-editor-sub">{card.title}</div>}

      <div className="tag-editor-head" inert={removing !== null}>
        <div className={query ? "tag-editor-search has-query" : "tag-editor-search"} onClick={() => searchRef.current?.focus()}>
          <Icon name="search" />
          <input
            ref={searchRef}
            value={query}
            placeholder="Найти или создать тег"
            aria-label="Найти или создать тег"
            autoFocus
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeys}
          />
          {canCreate && (
            <button type="button" className="tag-editor-create" onClick={create}>
              <Icon name="plus" />
              Создать
            </button>
          )}
        </div>
        <div className="tag-editor-sort" role="group" aria-label="Порядок тегов">
          <button type="button" aria-pressed={sort === "frequency"} onClick={() => changeSort("frequency")}>
            Частые
          </button>
          <button type="button" aria-pressed={sort === "alpha"} onClick={() => changeSort("alpha")}>
            А–Я
          </button>
        </div>
      </div>

      {error && (
        <p className="tag-editor-error" role="alert">
          {error}
        </p>
      )}

      {cardMode && words && (
        <div className="tag-editor-marks" inert={removing !== null}>
          <span className="tag-editor-marks-label">У {words.of}</span>
          {marks.length > 0 ? (
            <div className="tag-editor-marks-chips">
              {marks.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="tag-editor-mark"
                  data-mark={name}
                  style={chipStyle(name)}
                  aria-label={`Снять «${name}»`}
                  onClick={() => toggle(name, false, neighbour(marks, name))}
                >
                  <span className="tag-editor-mark-name">{name}</span>
                  <Icon name="close" />
                </button>
              ))}
            </div>
          ) : (
            <span className="tag-editor-marks-empty">Тегов пока нет — нажмите на тег ниже</span>
          )}
        </div>
      )}

      <div className="tag-editor-list-wrap">
        <div className="tag-editor-list" ref={listRef} inert={removing !== null} onKeyDown={handleListKeys}>
          {used.length > 0 && <div className="tag-editor-cloud">{used.map((tag) => chip(tag, false))}</div>}
          {unused.length > 0 && (
            <>
              <div className="tag-editor-group">
                <span>Не используются · {unused.length}</span>
                {query.trim() === "" && (
                  <button type="button" className="tag-editor-link tag-editor-link-danger" onClick={removeUnused}>
                    <Icon name="trash" />
                    Удалить все
                  </button>
                )}
              </div>
              <div className="tag-editor-cloud tag-editor-cloud-unused">{unused.map((tag) => chip(tag, true))}</div>
            </>
          )}
          {nothing && (
            <p className="tag-editor-empty">
              {canCreate
                ? "Такого тега нет — нажмите «Создать» или Enter"
                : query.trim() !== ""
                  ? "Этот тег уже стоит"
                  : all.length === 0
                    ? "Тегов пока нет — введите имя и нажмите «Создать»"
                    : "Все теги уже стоят"}
            </p>
          )}
          {!cardMode && selectedTag && detail(selectedTag)}
        </div>
        {removing && (
          <div
            className="tag-editor-ask"
            role="alertdialog"
            aria-labelledby="tag-editor-ask-title"
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              cancelRemove();
            }}
          >
            <div className="tag-editor-ask-card">
              <span className="tag-editor-ask-icon" aria-hidden="true">
                <Icon name="trash" />
              </span>
              <div className="tag-editor-ask-text">
                <b id="tag-editor-ask-title">Удалить тег «{removing.name}»?</b>
                <span>Он пропадёт у {usageFrom(removing)}. Сами карточки останутся.</span>
              </div>
              <div className="form-actions">
                <button type="button" autoFocus onClick={cancelRemove}>
                  Не удалять
                </button>
                <button type="button" className="danger-button" onClick={() => remove(removing.name)}>
                  <Icon name="trash" />
                  Удалить
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="form-actions tag-editor-foot" inert={removing !== null}>
        {card && !cardGone && words && (
          <button
            type="button"
            className="form-actions-lead tag-editor-mode"
            onClick={() => {
              setSelected(null);
              setRenaming(null);
              setEditing((v) => !v);
            }}
          >
            <Icon name={editing ? "arrow-left" : "edit"} />
            {editing ? words.back : "Править теги"}
          </button>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onClose();
          }}
        >
          <button type="submit">
            Готово
            <SubmitMark />
          </button>
        </form>
      </div>
    </div>
  );
}
