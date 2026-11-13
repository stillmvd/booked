import { useId, useMemo, useRef, useState } from "react";

import { findTagName, pickerRows } from "../lib/gameTags";
import type { TagRow } from "../lib/gameTags";
import { pluralizeRu } from "../lib/pluralizeRu";
import { Icon } from "./Icon";

interface GameTagPickerProps {
  catalog: TagRow[];
  mine: string[];
  forum: string[];
  onChange: (mine: string[]) => void;
}

const CREATE = "\u0000create";

export function GameTagPicker({ catalog, mine, forum, onChange }: GameTagPickerProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const [top, setTop] = useState(() => [...mine, ...forum]);

  const rows = useMemo(() => {
    const all = pickerRows(catalog, mine, forum, top);
    return [...all.filter((row) => row.forum), ...all.filter((row) => !row.forum)];
  }, [catalog, mine, forum, top]);
  const needle = query.trim().toLowerCase();
  const visible = needle === "" ? rows : rows.filter((row) => row.name.toLowerCase().includes(needle));
  const exact = findTagName(rows, query);
  const canCreate = needle !== "" && exact === null;
  const keys = [...visible.map((row) => row.name), ...(canCreate ? [CREATE] : [])];
  const current = active !== null && keys.includes(active) ? active : null;
  const owned = mine.length + forum.filter((name) => !mine.includes(name)).length;
  const forumRows = visible.filter((row) => row.forum);
  const ownRows = visible.filter((row) => !row.forum);
  const colsFor = (n: number) => Math.min(3, Math.max(1, Math.ceil(n / 4)));

  function isLocked(name: string) {
    if (mine.includes(name)) return false;
    return forum.includes(name) || rows.some((row) => row.name === name && row.forum);
  }

  function toggle(name: string) {
    if (isLocked(name)) return;
    onChange(mine.includes(name) ? mine.filter((item) => item !== name) : [...mine, name]);
  }

  function create() {
    const name = query.trim();
    if (name === "") return;
    if (!mine.includes(name)) onChange([...mine, name]);
    if (!rows.some((row) => row.name === name)) setTop((names) => [...names, name]);
    setQuery("");
    setActive(null);
  }

  function activate(key: string) {
    if (key === CREATE) create();
    else toggle(key);
  }

  function move(step: number) {
    if (keys.length === 0) return;
    const index = current === null ? (step > 0 ? 0 : keys.length - 1) : (keys.indexOf(current) + step + keys.length) % keys.length;
    const key = keys[index];
    setActive(key);
    requestAnimationFrame(() => document.getElementById(optionId(key))?.scrollIntoView({ block: "nearest" }));
  }

  function optionId(key: string) {
    return `${baseId}-${key === CREATE ? "create" : keys.indexOf(key)}`;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current !== null) activate(current);
      else if (exact !== null) toggle(exact);
      else if (canCreate) create();
    } else if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setQuery("");
    }
  }

  return (
    <div className="gtag-picker">
      <div className="gtag-find">
        <Icon name="tag" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={`${baseId}-list`}
          aria-activedescendant={current !== null ? optionId(current) : undefined}
          aria-label="Найти или создать тег"
          placeholder="Найти или создать тег"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(null);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="gtag-total">
          {owned === 0 ? "Нет тегов" : `${owned} ${pluralizeRu(owned, ["тег", "тега", "тегов"])}`}
        </span>
      </div>
      <div
        ref={listRef}
        className="gtag-groups"
        id={`${baseId}-list`}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Теги игры"
      >
        {forumRows.length > 0 ? (
          <div className="gtag-group" role="group" aria-labelledby={`${baseId}-forum`}>
            <span className="gtag-group-label" id={`${baseId}-forum`}>
              С форума
            </span>
            <div className="gtag-list" data-cols={colsFor(forumRows.length)}>
              {forumRows.map(option)}
            </div>
          </div>
        ) : null}
        {ownRows.length > 0 || canCreate ? (
          <div className="gtag-group" role="group" aria-labelledby={`${baseId}-own`}>
            <span className="gtag-group-label" id={`${baseId}-own`}>
              Мои
            </span>
            <div className="gtag-list" data-cols={colsFor(ownRows.length + (canCreate ? 1 : 0))}>
              {ownRows.map(option)}
              {canCreate ? (
                <button
                  type="button"
                  id={optionId(CREATE)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={false}
                  className={"gtag-option create" + (current === CREATE ? " cur" : "")}
                  onClick={create}
                >
                  <span className="gtag-check">
                    <Icon name="plus" />
                  </span>
                  <span className="gtag-name">Создать «{query.trim()}»</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {visible.length === 0 && !canCreate ? <p className="gtag-empty">Нет тегов</p> : null}
      </div>
    </div>
  );

  function option(row: TagRow) {
    const checked = mine.includes(row.name) || forum.includes(row.name);
    const locked = isLocked(row.name);
    return (
      <button
        key={row.name}
        type="button"
        id={optionId(row.name)}
        role="option"
        tabIndex={-1}
        aria-selected={checked}
        aria-disabled={locked || undefined}
        className={"gtag-option" + (checked ? " on" : "") + (locked ? " forum" : "") + (current === row.name ? " cur" : "")}
        title={locked ? "Тег с форума, меняется вместе со страницей игры" : undefined}
        onClick={() => toggle(row.name)}
      >
        {locked ? (
          <span className="gtag-lock">
            <Icon name="globe" />
          </span>
        ) : (
          <span className="gtag-check">{checked ? <Icon name="check" /> : null}</span>
        )}
        <span className="gtag-name">{row.name}</span>
      </button>
    );
  }
}
