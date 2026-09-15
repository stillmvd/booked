import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { bookmarkFindDuplicate, searchQuery } from "../lib/api";
import { addLink, fromBookmarkLinks, normalizeLinkInput, toLinkInputs } from "../lib/linksEdit";
import { displayLabel, linkCountLabel } from "../lib/platforms";
import type { Bookmark, DuplicateHit, LinkInput } from "../lib/types";
import { BookmarkThumb } from "./BookmarkThumb";
import { DuplicateBanner } from "./DuplicateBanner";
import { DialogPocket, SubmitMark } from "./DialogHead";
import { Icon } from "./Icon";
import { QuickUrlField } from "./QuickUrlField";

const SEARCH_DEBOUNCE_MS = 150;
const RESULT_LIMIT = 6;

export interface AppendLinkData {
  bookmarkId: number;
  title: string;
  links: LinkInput[];
}

interface Result {
  bookmark: Bookmark;
  folder: string;
}

interface AppendLinkFormProps {
  initialUrl: string;
  urlHint: string | null;
  externalError: string | null;
  onSubmit: (data: AppendLinkData) => void;
  onDirtyChange: (dirty: boolean) => void;
  onNavigateToDuplicate: () => void;
  onClose: () => void;
}

export function AppendLinkForm({
  initialUrl,
  urlHint,
  externalError,
  onSubmit,
  onDirtyChange,
  onNavigateToDuplicate,
  onClose,
}: AppendLinkFormProps) {
  const [url, setUrl] = useState(initialUrl);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const generationRef = useRef(0);
  const listId = useId();
  const hintId = `${listId}-hint`;
  const optionId = (id: number) => `${listId}-option-${id}`;

  const normalized = normalizeLinkInput(url);
  const selected = results.find((r) => r.bookmark.id === selectedId)?.bookmark ?? null;

  useEffect(() => {
    onDirtyChange(selectedId !== null || url.trim() !== initialUrl.trim());
  }, [selectedId, url, initialUrl, onDirtyChange]);

  useEffect(() => {
    const text = query.trim();
    const generation = ++generationRef.current;
    if (!text) {
      setResults([]);
      setSelectedId(null);
      return;
    }
    const timer = setTimeout(() => {
      searchQuery({
        text,
        tags: [],
        scopeFolderId: null,
        currentFolderId: null,
        sort: "relevance",
        limit: RESULT_LIMIT,
        offset: 0,
      })
        .then((r) => {
          if (generationRef.current !== generation) return;
          const next = r.bookmarks.map((bookmark, i) => ({
            bookmark,
            folder: r.highlights[i]?.folderPath.slice(-1)[0] ?? "Booked",
          }));
          setResults(next);
          setSelectedId((prev) => (next.some((x) => x.bookmark.id === prev) ? prev : (next[0]?.bookmark.id ?? null)));
        })
        .catch((err) => console.error(err));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setDuplicate(null);
    setError(null);
  }, [url, selectedId]);

  useEffect(() => {
    if (selectedId !== null) document.getElementById(optionId(selectedId))?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  async function submit(force: boolean, target: Bookmark | null = selected) {
    if (!normalized) {
      setError("Похоже, это не адрес страницы. Пример: instagram.com/имя");
      return;
    }
    if (!target) {
      setError("Найдите закладку, к которой добавить ссылку");
      return;
    }
    const added = addLink(fromBookmarkLinks(target.links), normalized);
    if (!added.ok) {
      setError(added.reason === "Эта ссылка уже есть в списке" ? `Эта ссылка уже есть у «${target.title}»` : added.reason);
      return;
    }
    if (!force) {
      setChecking(true);
      try {
        const hit = await bookmarkFindDuplicate(normalized, target.id);
        if (hit) {
          setDuplicate(hit);
          return;
        }
      } catch (err) {
        console.error(err);
      } finally {
        setChecking(false);
      }
    }
    onSubmit({ bookmarkId: target.id, title: target.title, links: toLinkInputs(added.links) });
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      const index = results.findIndex((r) => r.bookmark.id === selectedId);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = index < 0 ? 0 : (index + delta + results.length) % results.length;
      setSelectedId(results[next].bookmark.id);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void submit(false);
    }
  }

  const shownError = error ?? externalError;

  return (
    <form
      className="append-link"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      {duplicate ? (
        <DuplicateBanner
          hit={duplicate}
          linkLabel={normalized ? displayLabel(normalized, null) : undefined}
          onGoTo={onNavigateToDuplicate}
          onSaveAnyway={() => void submit(true)}
        />
      ) : null}

      <DialogPocket>
        <div className="field">
          <QuickUrlField
            label="Ссылка"
            value={url}
            autoFocus={!initialUrl}
            describedBy={urlHint && !url ? hintId : undefined}
            onChange={setUrl}
          />
          {urlHint && !url ? (
            <p className="field-hint" id={hintId}>
              {urlHint}
            </p>
          ) : null}
        </div>
      </DialogPocket>

      <DialogPocket>
        <label className="field">
          <span className="field-label">Закладка</span>
          <span className="append-link-search">
            <input
              className="append-link-search-input"
              value={query}
              placeholder="Найти по названию"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={selectedId !== null ? optionId(selectedId) : undefined}
              autoFocus={Boolean(initialUrl)}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <span className="append-link-search-icon" aria-hidden="true">
              <Icon name="search" />
            </span>
          </span>
        </label>

        <div className="append-link-results" id={listId} role="listbox" aria-label="Закладки">
          {results.map(({ bookmark, folder }) => {
            const on = bookmark.id === selectedId;
            return (
              <button
                key={bookmark.id}
                id={optionId(bookmark.id)}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={-1}
                className={"append-link-result" + (on ? " on" : "")}
                onClick={() => setSelectedId(bookmark.id)}
                onDoubleClick={() => {
                  setSelectedId(bookmark.id);
                  void submit(false, bookmark);
                }}
              >
                <BookmarkThumb bookmark={bookmark} className="append-link-photo" />
                <span className="append-link-who">
                  <span className="append-link-title">{bookmark.title}</span>
                  <span className="append-link-meta">
                    {folder} · {linkCountLabel(bookmark.links.length)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {query.trim() && results.length === 0 ? <p className="field-hint">Ничего не нашлось</p> : null}
      </DialogPocket>

      {shownError ? <p className="form-error">{shownError}</p> : null}

      <div className="form-actions">
        <span className="quick-buttons">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" disabled={!selected || !normalized || checking}>
            <span className="quick-submit-text">{selected ? `Добавить к «${selected.title}»` : "Добавить к закладке"}</span>
            <SubmitMark />
          </button>
        </span>
      </div>
    </form>
  );
}
