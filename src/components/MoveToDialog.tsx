import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { buildMoveTargets, filterTargets, normalizeQuery } from "../lib/folderTree";
import type { MoveActive } from "../lib/folderTree";
import type { FolderRef } from "../lib/types";
import { CmdkEmpty, CmdkHead, CmdkSearch } from "./CmdkParts";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

const ROOT_ID = -1;

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
  const hoverRef = useRef(false);

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

  const rootRow: Row = { id: ROOT_ID, name: "Booked", path: [], root: true };
  const realRows: Row[] = filtered.map((t) => ({ id: t.id, name: t.name, path: t.path, root: false }));
  const navRows: Row[] = [rootRow, ...(showZeroHint ? [] : realRows)];

  const activeRow = navRows[activeIndex];
  const activeId = activeRow ? optionId(activeRow.id) : undefined;

  useEffect(() => {
    if (activeId && !hoverRef.current) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    hoverRef.current = false;
  }, [activeId]);

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

  function hover(index: number) {
    if (index === activeIndex) return;
    hoverRef.current = true;
    setActiveIndex(index);
  }

  function renderRow(row: Row, index: number) {
    const selected = activeRow?.id === row.id;
    const id = optionId(row.id);
    return (
      <div
        key={id}
        id={id}
        role="option"
        aria-selected={selected}
        className="cmdk-row move-row"
        onMouseMove={() => hover(index)}
        onClick={() => runRow(row)}
      >
        <span className="move-row-glyph">
          <Icon name={row.root ? "bookmark" : "folder"} />
        </span>
        <span className="move-row-name">{row.name}</span>
        {row.path.length > 0 && <span className="move-row-path">{row.path.join(" / ")}</span>}
      </div>
    );
  }

  return (
    <Modal onClose={onClose} titleId="move-dialog-title">
      <div className="cmdk-panel">
        <CmdkHead id="move-dialog-title" title="Переместить в…" onClose={onClose} />
        <CmdkSearch
          inputRef={inputRef}
          listId="move-listbox"
          activeId={activeId}
          placeholder="Найти папку…"
          value={text}
          onChange={setText}
          onKeyDown={handleKeyDown}
        />
        <div className="cmdk-list" role="listbox" id="move-listbox">
          <div className="cmdk-group" role="none">
            {renderRow(rootRow, 0)}
            {showZeroHint ? (
              <CmdkEmpty title="Ничего не найдено" hint="Проверьте раскладку" />
            ) : (
              realRows.map((row, i) => renderRow(row, i + 1))
            )}
          </div>
        </div>
        {loadFailed && <p className="move-empty">Папки не загрузились</p>}
      </div>
    </Modal>
  );
}
