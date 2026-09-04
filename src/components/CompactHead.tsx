import { MorphIcon } from "morphicons/react";
import type { SortDir, SortKey } from "../lib/sortRows";
import { ICONS } from "./Icon";

interface Column {
  key: SortKey;
  label: string;
  className: string;
}

const COLUMNS: Column[] = [
  { key: "name", label: "Название", className: "col-name" },
  { key: "host", label: "Хост", className: "col-host" },
  { key: "added", label: "Добавлено", className: "col-added" },
  { key: "tags", label: "Теги", className: "col-tags" },
];

interface CompactHeadProps {
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

export function CompactHead({ sortKey, sortDir, onSort }: CompactHeadProps) {
  return (
    <div className="compact-head">
      <span className="col-spacer" aria-hidden="true" />
      {COLUMNS.map((col) => {
        const active = sortKey === col.key;
        const order = active ? (sortDir === "asc" ? "по возрастанию" : "по убыванию") : null;
        return (
          <button
            key={col.key}
            type="button"
            className={col.className + (active ? " sorted" : "")}
            aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            aria-label={order ? `${col.label}, сортировка ${order}` : `${col.label}, сортировать`}
            onClick={() => onSort(col.key)}
          >
            {col.label}
            {active && (
              <MorphIcon
                icon={ICONS[sortDir === "asc" ? "chevron-up" : "chevron-down"]}
                viewBox="0 0 16 16"
                size={16}
                strokeWidth={1.5}
                spring="snappy"
                reducedMotion="user"
                className="icon sort-arrow"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
