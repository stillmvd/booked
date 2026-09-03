import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";

import type { Rect } from "../lib/menuPosition";
import { readStored, writeStored } from "../lib/storage";
import { buildTree, firstChildIndex, parentIndex, pathTo, visibleRows } from "../lib/tree";
import type { FolderNode } from "../lib/types";
import { Icon } from "./Icon";

const EXPANDED_KEY = "booked.tree.expanded";
export const TREE_ROOT_DOM_ID = "tree-root";

export function treeNodeDomId(id: number): string {
  return `tree-f${id}`;
}

interface FolderTreeProps {
  nodes: FolderNode[];
  totalCount: number;
  currentFolderId: number | null;
  onOpenFolder: (id: number | null) => void;
  onNodeMenu: (node: FolderNode, anchor: Rect, triggerId: string) => void;
}

export function FolderTree({ nodes, totalCount, currentFolderId, onOpenFolder, onNodeMenu }: FolderTreeProps) {
  const navRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(readStored<number[]>(EXPANDED_KEY, [])));
  const autoExpandedForRef = useRef<number | null>(null);

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  useEffect(() => {
    writeStored(EXPANDED_KEY, [...expanded]);
  }, [expanded]);

  useEffect(() => {
    if (currentFolderId === null || autoExpandedForRef.current === currentFolderId) return;
    if (!byId.has(currentFolderId)) return;
    autoExpandedForRef.current = currentFolderId;
    const path = pathTo(nodes, currentFolderId);
    if (path.length === 0) return;
    setExpanded((prev) => new Set([...prev, ...path]));
  }, [currentFolderId, nodes, byId]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setOpen(id: number, open: boolean) {
    setExpanded((prev) => {
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    const nav = navRef.current;
    if (!nav) return;
    const items = [...nav.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const rowIndex = i - 1;
    const row = rowIndex >= 0 ? rows[rowIndex] : null;
    let target: number;
    switch (e.key) {
      case "ArrowDown":
        target = Math.min(i + 1, items.length - 1);
        break;
      case "ArrowUp":
        target = Math.max(i - 1, 0);
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = items.length - 1;
        break;
      case "ArrowRight": {
        if (!row?.hasChildren) return;
        e.preventDefault();
        if (!row.expanded) {
          setOpen(row.id, true);
          return;
        }
        const child = firstChildIndex(rows, rowIndex);
        if (child < 0) return;
        target = child + 1;
        break;
      }
      case "ArrowLeft": {
        if (!row) return;
        e.preventDefault();
        if (row.expanded) {
          setOpen(row.id, false);
          return;
        }
        const parent = parentIndex(rows, rowIndex);
        if (parent < 0) return;
        target = parent + 1;
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    items[target]?.focus();
  }

  function handleContextMenu(e: MouseEvent<HTMLButtonElement>, id: number) {
    const node = byId.get(id);
    if (!node) return;
    e.preventDefault();
    const keyboard = e.detail === 0 && e.button !== 2;
    const anchor: Rect = keyboard
      ? e.currentTarget.getBoundingClientRect()
      : { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY };
    e.currentTarget.focus({ preventScroll: true });
    onNodeMenu(node, anchor, treeNodeDomId(id));
  }

  const currentVisible = currentFolderId !== null && rows.some((r) => r.id === currentFolderId);
  const rootIsAnchor = currentFolderId === null || !currentVisible;

  return (
    <nav className="tree" role="tree" aria-label="Папки" ref={navRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        id={TREE_ROOT_DOM_ID}
        role="treeitem"
        aria-level={1}
        aria-selected={currentFolderId === null}
        className={"tnode" + (currentFolderId === null ? " current" : "")}
        tabIndex={rootIsAnchor ? 0 : -1}
        onClick={() => onOpenFolder(null)}
      >
        <span className="tnode-caret" aria-hidden="true" />
        <span className="tnode-name">Все закладки</span>
        <span className="tnode-count">{totalCount}</span>
      </button>
      {rows.map((row) => {
        const current = row.id === currentFolderId;
        return (
          <button
            key={row.id}
            type="button"
            id={treeNodeDomId(row.id)}
            role="treeitem"
            aria-level={row.level}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={current}
            className={"tnode" + (current ? " current" : "")}
            style={{ "--level": row.level } as CSSProperties}
            tabIndex={current ? 0 : -1}
            onClick={() => onOpenFolder(row.id)}
            onContextMenu={(e) => handleContextMenu(e, row.id)}
          >
            {row.hasChildren ? (
              <span
                className="tnode-caret"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(row.id);
                }}
              >
                <Icon name={row.expanded ? "chevron-down" : "chevron-right"} />
              </span>
            ) : (
              <span className="tnode-caret" aria-hidden="true" />
            )}
            <span className="tnode-name">{row.name}</span>
            <span className="tnode-count">{row.bookmarkCount}</span>
          </button>
        );
      })}
    </nav>
  );
}
