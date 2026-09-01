import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { buildMoveTargets, filterTargets, normalizeQuery } from "../lib/folderTree";
import type { MoveActive } from "../lib/folderTree";
import type { FolderRef } from "../lib/types";
import { Modal } from "./Modal";

const ROOT_ID = -1;
const MOVE_GLYPH_PATH =
  "M0.5 1.7C0.5 1 1.06 0.5 1.75 0.5H5.4L6.6 2H12.25C12.94 2 13.5 2.56 13.5 3.25V9.25C13.5 9.94 12.94 10.5 12.25 10.5H1.75C1.06 10.5 0.5 9.94 0.5 9.25V1.7Z";

interface Row {
  id: number;
  name: string;
  path: string[];
  root: boolean;
}

export interface MoveToDialogProps {
  active: MoveActive;
  folders: FolderRef[];
  loadFailed: boolean;
  onClose: () => void;
  onMove: (targetFolderId: number | null, targetName: string) => void;
}

function optionId(id: number): string {
  return `move-option-${id}`;
}

export function MoveToDialog({ active, folders, loadFailed, onClose, onMove }: MoveToDialogProps) {
  const [text, setText] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [text]);

  const targets = buildMoveTargets(folders, active);
  const filtered = filterTargets(targets, text);
  const hasQuery = normalizeQuery(text) !== "";
  const showZeroHint = filtered.length === 0 && hasQuery;

  const rootRow: Row = { id: ROOT_ID, name: "Корень", path: [], root: true };
  const realRows: Row[] = filtered.map((t) => ({ id: t.id, name: t.name, path: t.path, root: false }));
  const navRows: Row[] = [rootRow, ...(showZeroHint ? [] : realRows)];

  const activeRow = navRows[activeIndex];
  const activeId = activeRow ? optionId(activeRow.id) : undefined;

  function runRow(row: Row) {
    onMove(row.root ? null : row.id, row.name);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (navRows.length === 0) return;
      setActiveIndex((i) => Math.min(i + 1, navRows.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (navRows.length === 0) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      if (navRows.length === 0) return;
      setActiveIndex(navRows.length - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = navRows[activeIndex];
      if (!row) return;
      runRow(row);
    }
  }

  function renderRow(row: Row) {
    const selected = activeRow?.id === row.id;
    const id = optionId(row.id);
    return (
      <div key={id} id={id} role="option" aria-selected={selected} className="move-row" onClick={() => runRow(row)}>
        <svg
          className="move-row-glyph"
          viewBox="0 0 14 11"
          aria-hidden="true"
          {...(row.root ? { fill: "none", stroke: "var(--support)", strokeWidth: 1 } : {})}
        >
          <path d={MOVE_GLYPH_PATH} />
        </svg>
        <span className="move-row-name">{row.name}</span>
        {row.path.length > 0 && <span className="move-row-path">{row.path.join(" / ")}</span>}
      </div>
    );
  }

  return (
    <Modal onClose={onClose}>
      <div className="cmdk-panel">
        <div className="bookmark-form">
          <h2>Переместить в…</h2>
        </div>
        <input
          ref={inputRef}
          type="text"
          className="cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="move-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          placeholder="Найти папку…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="cmdk-list" role="listbox" id="move-listbox">
          {renderRow(rootRow)}
          {showZeroHint ? <div className="cmdk-zero">Ничего не найдено</div> : realRows.map((row) => renderRow(row))}
        </div>
        {loadFailed && <p className="move-empty">Папки не загрузились</p>}
      </div>
    </Modal>
  );
}
