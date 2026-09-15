import { narrowingState, SEARCH_PAGE, summaryParts } from "../lib/searchSummary";
import type { SearchSort } from "../lib/types";
import { Icon } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

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
  const parts = summaryParts(total, query, tags);
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
        <div className="results-summary-text" aria-live="polite">
          <p className="results-summary-count">
            <b>{total}</b> <span className="results-summary-word">{parts.word}</span>
          </p>
          {parts.query || parts.tags ? (
            <p className="results-summary-rest">
              {parts.query ? <span className="results-summary-query">{parts.query}</span> : null}
              {parts.query && parts.tags ? <span aria-hidden="true">·</span> : null}
              {parts.tags ? <span>{parts.tags}</span> : null}
            </p>
          ) : null}
        </div>
        {showSortSwitch && (
          <div className="sort-switch" role="group" aria-label="Порядок сортировки">
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
        <ShowcaseNote icon="search">Ничего не нашлось. Попробуйте другой запрос или снимите часть тегов.</ShowcaseNote>
      ) : state.kind === "narrow-offer" ? (
        <div className="narrowing-plaque">
          <span className="narrowing-plaque-icon" aria-hidden="true">
            <Icon name="folder" />
          </span>
          <span className="narrowing-plaque-text">
            <b>{state.count}</b> из них в «<b className="narrowing-plaque-folder">{state.folderName}</b>»
          </span>
          <button type="button" className="narrowing-plaque-action" onClick={onNarrowToFolder}>
            Только здесь
            <span className="narrowing-plaque-mark" aria-hidden="true">
              <Icon name="arrow-right" />
            </span>
          </button>
        </div>
      ) : state.kind === "escalate" ? (
        <div className="narrowing-plaque narrowing-plaque-danger">
          <span className="narrowing-plaque-icon" aria-hidden="true">
            <Icon name="search" />
          </span>
          <span className="narrowing-plaque-text">
            В «<b className="narrowing-plaque-folder">{state.folderName}</b>» ничего — <b>{state.outsideCount}</b> снаружи
          </span>
          <button type="button" className="narrowing-plaque-action" onClick={onEscalateToGlobal}>
            Искать везде
            <span className="narrowing-plaque-mark" aria-hidden="true">
              <Icon name="arrow-right" />
            </span>
          </button>
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
      <Icon name="chevron-down" />
    </button>
  );
}
