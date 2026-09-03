import type { FolderNode } from "./types.ts";

export interface TreeNode {
  id: number;
  name: string;
  bookmarkCount: number;
  children: TreeNode[];
}

export interface TreeRow {
  id: number;
  name: string;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  bookmarkCount: number;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "ru");
}

export function buildTree(nodes: FolderNode[]): TreeNode[] {
  const byParent = new Map<number | null, FolderNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const seen = new Set<number>();
  function build(parentId: number | null): TreeNode[] {
    const out: TreeNode[] = [];
    for (const node of byParent.get(parentId) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ id: node.id, name: node.name, bookmarkCount: node.bookmarkCount, children: build(node.id) });
    }
    return out.sort(byName);
  }
  return build(null);
}

export function subtreeCount(node: TreeNode): number {
  return node.children.reduce((sum, child) => sum + subtreeCount(child), node.bookmarkCount);
}

export function visibleRows(tree: TreeNode[], expandedIds: Set<number>): TreeRow[] {
  const rows: TreeRow[] = [];
  function walk(nodes: TreeNode[], level: number) {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && expandedIds.has(node.id);
      rows.push({
        id: node.id,
        name: node.name,
        level,
        hasChildren,
        expanded,
        bookmarkCount: hasChildren && !expanded ? subtreeCount(node) : node.bookmarkCount,
      });
      if (expanded) walk(node.children, level + 1);
    }
  }
  walk(tree, 1);
  return rows;
}

export function pathTo(nodes: FolderNode[], id: number): number[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: number[] = [];
  const visited = new Set<number>([id]);
  let current = byId.get(id)?.parentId ?? null;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    path.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return path.reverse();
}

export function parentIndex(rows: TreeRow[], i: number): number {
  const level = rows[i]?.level ?? 0;
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j].level < level) return j;
  }
  return -1;
}

export function firstChildIndex(rows: TreeRow[], i: number): number {
  const row = rows[i];
  if (!row?.expanded) return -1;
  return rows[i + 1]?.level === row.level + 1 ? i + 1 : -1;
}
