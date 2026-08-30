import { narrowingState, SEARCH_PAGE, summaryText } from "../lib/searchSummary";
import type { SearchSort } from "../lib/types";

interface ResultsSummaryProps {
  total: number;
  totalGlobal: number;
  inCurrentFolder: number;
  query: string;
  tags: string[];
  sort: SearchSort;
  onSortChange: (sort: SearchSort) => void;
  scopeFolderId: number | null;
  currentFolderId: number | null;
  currentFolderName: string | null;
  onNarrowToFolder: () => void;
  onEscalateToGlobal: () => void;
  bothEmpty: boolean;
}

function splitSummary(text: string): { count: string; rest: string } {
  const match = text.match(/^(\S+\s+\S+)([\s\S]*)$/);
  if (!match) return { count: text, rest: "" };
  return { count: match[1], rest: match[2] };
}

export function ResultsSummary({
  total,
  totalGlobal,
  inCurrentFolder,
  query,
  tags,
  sort,
  onSortChange,
  scopeFolderId,
  currentFolderId,
  currentFolderName,
  onNarrowToFolder,
  onEscalateToGlobal,
  bothEmpty,
}: ResultsSummaryProps) {
  const { count, rest } = splitSummary(summaryText(total, query, tags));
  const showSortSwitch = query.trim() !== "";
  const state = narrowingState({
    scopeFolderId,
    currentFolderId,
    currentFolderName,
    total,
    totalGlobal,
    inCurrentFolder,
  });

  return (
    <div className="results-summary-wrap">
      <div className="results-summary">
        <span className="results-summary-text">
          <span className="results-summary-count" aria-live="polite">
            {count}
          </span>
          {rest}
        </span>
        {showSortSwitch && (
          <div className="mode-switch" role="group" aria-label="Порядок сортировки">
            <button type="button" aria-pressed={sort === "relevance"} onClick={() => onSortChange("relevance")}>
              Релевантность
            </button>
            <button type="button" aria-pressed={sort === "date"} onClick={() => onSortChange("date")}>
              Дата
            </button>
          </div>
        )}
      </div>
      {bothEmpty ? (
        <p className="showcase-note">Ничего не нашлось. Попробуйте другой запрос или снимите часть тегов.</p>
      ) : state.kind === "narrow-offer" ? (
        <div className="narrowing-plaque">
          <span>
            {state.count} из них в «
            <span className="narrowing-plaque-folder">{state.folderName}</span>» ·{" "}
            <button type="button" className="link-button" onClick={onNarrowToFolder}>
              Только здесь
            </button>
          </span>
        </div>
      ) : state.kind === "escalate" ? (
        <div className="narrowing-plaque narrowing-plaque-danger">
          <span>
            В «
            <span className="narrowing-plaque-folder">{state.folderName}</span>» ничего — {state.outsideCount}{" "}
            снаружи ·{" "}
            <button type="button" className="link-button" onClick={onEscalateToGlobal}>
              Искать везде
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

interface ShowMoreButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ShowMoreButton({ visible, onClick }: ShowMoreButtonProps) {
  if (!visible) return null;
  return (
    <button type="button" className="results-more" onClick={onClick}>
      Показать ещё {SEARCH_PAGE}
    </button>
  );
}
