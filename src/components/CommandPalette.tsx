import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { searchQuery } from "../lib/api";
import { HIGHLIGHT_OPEN } from "../lib/highlight";
import { livenessClass } from "../lib/liveness";
import { hostOf } from "../lib/plate";
import type { Bookmark, Folder, FolderMatch, NavTarget, SearchHighlight } from "../lib/types";
import { BookmarkThumb } from "./BookmarkThumb";
import { CmdkEmpty, CmdkHead, CmdkSearch } from "./CmdkParts";
import { Highlighted } from "./Highlighted";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

const PALETTE_LIMIT = 20;

interface FolderRowData {
  kind: "folder";
  id: number;
  folder: Folder;
  match: FolderMatch;
}

interface BookmarkRowData {
  kind: "bookmark";
  id: number;
  bookmark: Bookmark;
  highlight: SearchHighlight;
}

type PaletteRowData = FolderRowData | BookmarkRowData;

interface PaletteResults {
  folders: Folder[];
  folderMatches: FolderMatch[];
  bookmarks: Bookmark[];
  highlights: SearchHighlight[];
}

const EMPTY_RESULTS: PaletteResults = { folders: [], folderMatches: [], bookmarks: [], highlights: [] };

function optionId(kind: "folder" | "bookmark", id: number): string {
  return `cmdk-option-${kind}-${id}`;
}

function joinMeta(parts: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(<span key={`sep${i}`} className="cmdk-row-sep">·</span>);
    out.push(part);
  });
  return out;
}

export interface CommandPaletteProps {
  onClose: () => void;
  onOpenFolder: (folder: Folder) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onNavigateToFolder: (hit: NavTarget) => void;
}

export function CommandPalette({ onClose, onOpenFolder, onOpenBookmark, onNavigateToFolder }: CommandPaletteProps) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<PaletteResults>(EMPTY_RESULTS);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoverRef = useRef(false);
  const generationRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    inputRef.current?.focus();
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === "") {
      generationRef.current += 1;
      setResults(EMPTY_RESULTS);
      setActiveIndex(0);
      return;
    }
    const generation = ++generationRef.current;
    searchQuery({
      text,
      tags: [],
      scopeFolderId: null,
      currentFolderId: null,
      sort: "relevance",
      limit: PALETTE_LIMIT,
      offset: 0,
    })
      .then((r) => {
        if (!aliveRef.current || generationRef.current !== generation) return;
        setResults({
          folders: r.folders.slice(0, PALETTE_LIMIT),
          folderMatches: r.folderMatches.slice(0, PALETTE_LIMIT),
          bookmarks: r.bookmarks,
          highlights: r.highlights,
        });
        setActiveIndex(0);
      })
      .catch((err) => console.error(err));
  }, [text]);

  const folderRows: FolderRowData[] = results.folders.map((folder, i) => ({
    kind: "folder",
    id: folder.id,
    folder,
    match: results.folderMatches[i],
  }));
  const bookmarkRows: BookmarkRowData[] = results.bookmarks.map((bookmark, i) => ({
    kind: "bookmark",
    id: bookmark.id,
    bookmark,
    highlight: results.highlights[i],
  }));
  const rows: PaletteRowData[] = [...folderRows, ...bookmarkRows];

  const showEmptyHint = text.trim() === "";
  const showZero = !showEmptyHint && rows.length === 0;
  const activeRow = rows[activeIndex];
  const activeId = activeRow ? optionId(activeRow.kind, activeRow.id) : undefined;

  useEffect(() => {
    if (activeId && !hoverRef.current) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    hoverRef.current = false;
  }, [activeId]);

  function hover(index: number) {
    if (index === activeIndex) return;
    hoverRef.current = true;
    setActiveIndex(index);
  }

  function runRow(row: PaletteRowData) {
    if (row.kind === "bookmark") {
      onOpenBookmark(row.bookmark);
    } else {
      onOpenFolder(row.folder);
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (!row) return;
      if (e.ctrlKey) {
        if (row.kind === "bookmark") {
          onNavigateToFolder({
            id: row.bookmark.id,
            title: row.bookmark.title,
            folderId: row.bookmark.folderId,
            folderName: null,
          });
          onClose();
        }
        return;
      }
      runRow(row);
    }
  }

  function renderRow(row: PaletteRowData, index: number) {
    const selected = index === activeIndex;
    const id = optionId(row.kind, row.id);

    if (row.kind === "folder") {
      const metaParts: ReactNode[] = [];
      if (row.match.path.length > 0) {
        metaParts.push(
          <span key="path" className="cmdk-row-path">
            {row.match.path.join(" / ")}
          </span>,
        );
      }
      return (
        <div
          key={id}
          id={id}
          role="option"
          aria-selected={selected}
          className="cmdk-row"
          onMouseMove={() => hover(index)}
          onClick={() => runRow(row)}
        >
          <span className="cmdk-row-thumb" aria-hidden="true">
            <Icon name="folder" />
          </span>
          <span className="cmdk-row-body">
            <span className="cmdk-row-title">
              <Highlighted text={row.match.nameHighlighted} />
            </span>
            {metaParts.length > 0 && <span className="cmdk-row-meta">{joinMeta(metaParts)}</span>}
          </span>
        </div>
      );
    }

    const { bookmark, highlight } = row;
    const liveness = livenessClass(bookmark);
    const host = hostOf(bookmark.urlNormalized);
    const titleMarked = highlight.title.includes(HIGHLIGHT_OPEN);
    const hostMarked = highlight.host.includes(HIGHLIGHT_OPEN);
    const descMatched = !titleMarked && !hostMarked && highlight.snippet.includes(HIGHLIGHT_OPEN);

    const metaParts: ReactNode[] = [];
    if (host) {
      metaParts.push(
        <span key="host" className="cmdk-row-host">
          <Highlighted text={highlight.host} />
        </span>,
      );
    }
    if (highlight.folderPath.length > 0) {
      metaParts.push(
        <span key="path" className="cmdk-row-path">
          {highlight.folderPath.join(" / ")}
        </span>,
      );
    }
    if (descMatched) {
      metaParts.push(
        <span key="snip" className="cmdk-row-snippet">
          <Highlighted text={highlight.snippet} />
        </span>,
      );
    }

    return (
      <div
        key={id}
        id={id}
        role="option"
        aria-selected={selected}
        className="cmdk-row"
        onMouseMove={() => hover(index)}
        onClick={() => runRow(row)}
      >
        <BookmarkThumb bookmark={bookmark} className="cmdk-row-thumb" />
        <span className="cmdk-row-body">
          <span className="cmdk-row-title">
            {liveness === "dead" && <span className="row-status-glyph">⊘</span>}
            {liveness === "warn" && <span className="row-status-dot" />}
            <Highlighted text={highlight.title} />
          </span>
          {metaParts.length > 0 && <span className="cmdk-row-meta">{joinMeta(metaParts)}</span>}
        </span>
      </div>
    );
  }

  return (
    <Modal onClose={onClose} label="Поиск закладок и папок">
      <div className="cmdk-panel">
        <CmdkHead title="Поиск" onClose={onClose} />
        <CmdkSearch
          inputRef={inputRef}
          listId="cmdk-listbox"
          activeId={activeId}
          placeholder="Найти закладку или папку…"
          value={text}
          onChange={setText}
          onKeyDown={handleKeyDown}
        />
        {showEmptyHint ? (
          <div className="cmdk-group">
            <CmdkEmpty title="Найдите закладку или папку" hint="По названию, адресу или описанию" />
          </div>
        ) : showZero ? (
          <div className="cmdk-group">
            <CmdkEmpty title="Ничего не найдено" hint="Проверьте раскладку или поищите по адресу" />
          </div>
        ) : (
          <div className="cmdk-list" role="listbox" id="cmdk-listbox">
            {folderRows.length > 0 && (
              <div className="cmdk-group" role="group" aria-label={`Папки · ${folderRows.length}`}>
                {folderRows.map((row, i) => renderRow(row, i))}
              </div>
            )}
            {bookmarkRows.length > 0 && (
              <div className="cmdk-group" role="group" aria-label={`Закладки · ${bookmarkRows.length}`}>
                {bookmarkRows.map((row, i) => renderRow(row, folderRows.length + i))}
              </div>
            )}
          </div>
        )}
        <div className="cmdk-footer">
          <span className="cmdk-hint">
            <kbd className="cmdk-key">↑↓</kbd>выбрать
          </span>
          <span className="cmdk-hint">
            <kbd className="cmdk-key">Enter</kbd>открыть
          </span>
          <span className="cmdk-hint">
            <kbd className="cmdk-key">Ctrl+Enter</kbd>в папке
          </span>
        </div>
      </div>
    </Modal>
  );
}
