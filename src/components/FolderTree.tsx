import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { MorphIcon } from "morphicons/react";

import { SPRING_LOAD_MS, treeDropId } from "../lib/dragIds";
import { DragTargetContext } from "../lib/dragTargetContext";
import { edgeScrollStep } from "../lib/edgeScroll";
import type { Rect } from "../lib/menuPosition";
import { readStored, writeStored } from "../lib/storage";
import { buildTree, firstChildIndex, parentIndex, pathTo, visibleRows } from "../lib/tree";
import type { FolderNode } from "../lib/types";
import { ICONS } from "./Icon";

const EXPANDED_KEY = "booked.tree.expanded";
const AUTO_SCROLL_TICK_MS = 16;
export const TREE_ROOT_DOM_ID = "tree-root";

export function treeNodeDomId(id: number): string {
  return `tree-f${id}`;
}

function TreeItem({ folderId, ...rest }: { folderId: number | null } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setNodeRef } = useDroppable({ id: treeDropId(folderId) });
  return <button type="button" ref={setNodeRef} {...rest} />;
}

function dropClass(folderId: number | null, overTreeFolderId: number | null | undefined, allowed: boolean): string {
  if (overTreeFolderId !== folderId) return "";
  return allowed ? " drop-target" : " no-drop";
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
  const { overTreeFolderId, allowed, dragging } = useContext(DragTargetContext);
  const { measureDroppableContainers } = useDndContext();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    writeStored(EXPANDED_KEY, [...expanded]);
  }, [expanded]);

  useEffect(() => {
    if (typeof overTreeFolderId !== "number") return;
    const row = rows.find((r) => r.id === overTreeFolderId);
    if (!row?.hasChildren || row.expanded) return;
    const timer = window.setTimeout(() => setOpen(overTreeFolderId, true), SPRING_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [overTreeFolderId, rows]);

  useEffect(() => {
    const nav = navRef.current;
    if (!dragging || !nav) return;
    let x = -1;
    let y = -1;
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
    };
    window.addEventListener("pointermove", onMove);
    const timer = window.setInterval(() => {
      const r = nav.getBoundingClientRect();
      if (x < r.left || x > r.right) return;
      const step = edgeScrollStep(y, r.top, r.bottom);
      if (step === 0) return;
      const before = nav.scrollTop;
      nav.scrollTop += step;
      if (nav.scrollTop === before) return;
      measureDroppableContainers([treeDropId(null), ...rowsRef.current.map((row) => treeDropId(row.id))]);
    }, AUTO_SCROLL_TICK_MS);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.clearInterval(timer);
    };
  }, [dragging, measureDroppableContainers]);

  useEffect(() => {
    if (currentFolderId === null || autoExpandedForRef.current === currentFolderId) return;
    if (!byId.has(currentFolderId)) return;
    autoExpandedForRef.current = currentFolderId;
    const path = [...pathTo(nodes, currentFolderId), currentFolderId];
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
      <TreeItem
        folderId={null}
        id={TREE_ROOT_DOM_ID}
        role="treeitem"
        aria-level={1}
        aria-selected={currentFolderId === null}
        className={"tnode" + (currentFolderId === null ? " current" : "") + dropClass(null, overTreeFolderId, allowed)}
        tabIndex={rootIsAnchor ? 0 : -1}
        onClick={() => onOpenFolder(null)}
      >
        <span className="tnode-caret" aria-hidden="true" />
        <span className="tnode-name">Все закладки</span>
        <span className="tnode-count">{totalCount}</span>
      </TreeItem>
      {rows.map((row) => {
        const current = row.id === currentFolderId;
        return (
          <TreeItem
            key={row.id}
            folderId={row.id}
            id={treeNodeDomId(row.id)}
            role="treeitem"
            aria-level={row.level}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={current}
            className={"tnode" + (current ? " current" : "") + dropClass(row.id, overTreeFolderId, allowed)}
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
                <MorphIcon
                  icon={ICONS[row.expanded ? "chevron-down" : "chevron-right"]}
                  viewBox="0 0 16 16"
                  size={16}
                  strokeWidth={1.5}
                  spring="snappy"
                  reducedMotion="user"
                  className="icon"
                />
              </span>
            ) : (
              <span className="tnode-caret" aria-hidden="true" />
            )}
            <span className="tnode-name">{row.name}</span>
            <span className="tnode-count">{row.bookmarkCount}</span>
          </TreeItem>
        );
      })}
    </nav>
  );
}
