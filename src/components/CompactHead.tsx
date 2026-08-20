import type { SortDir, SortKey } from "../lib/sortRows";

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
        return (
          <button
            key={col.key}
            type="button"
            className={col.className + (active ? " sorted" : "")}
            onClick={() => onSort(col.key)}
          >
            {col.label}
            {active && <span className="sort-arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
          </button>
        );
      })}
    </div>
  );
}
