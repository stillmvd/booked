import { useState } from "react";

import { visibleTagRows } from "../lib/gameTags";
import type { TagRow } from "../lib/gameTags";
import { pluralizeRu } from "../lib/pluralizeRu";
import { Icon } from "./Icon";

interface GameTagFilterProps {
  rows: TagRow[];
  selected: string[];
  onToggle: (name: string) => void;
  onDictionary: () => void;
}

export function GameTagFilter({ rows, selected, onToggle, onDictionary }: GameTagFilterProps) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const { shown, hidden } = visibleTagRows(rows, selected, expanded);

  return (
    <section className="gtag-filter" aria-labelledby="gtag-filter-label">
      <div className="gtag-filter-head">
        <h3 id="gtag-filter-label" className="gtag-filter-label">
          Теги
        </h3>
        <button type="button" className="gtag-quiet" onClick={onDictionary}>
          <Icon name="tag" />
          Словарь
        </button>
      </div>
      <div className="gtag-filter-list">
        {shown.map((row) => {
          const on = selected.includes(row.name);
          return (
            <button
              key={row.name}
              type="button"
              className={"gtag-row" + (on ? " on" : "") + (row.forum ? " forum" : "") + (row.count === 0 && !on ? " zero" : "")}
              aria-pressed={on}
              aria-label={`${row.name}, ${row.count} ${pluralizeRu(row.count, ["игра", "игры", "игр"])}`}
              onClick={() => onToggle(row.name)}
            >
              {row.forum ? <Icon name="globe" className="gtag-globe" /> : null}
              <span className="gtag-row-name">{row.name}</span>
              <span className="gtag-row-count">{row.count}</span>
            </button>
          );
        })}
        {hidden > 0 || expanded ? (
          <button type="button" className="gtag-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Свернуть" : `Ещё ${hidden}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
