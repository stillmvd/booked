import type { FolderRef } from "./types.ts";

export interface MoveTarget {
  id: number;
  name: string;
  path: string[];
}

export interface MoveActive {
  kind: "folder" | "bookmark";
  id: number;
  folderId: number | null;
}

export function ancestorPath(folders: FolderRef[], id: number): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  const visited = new Set<number>();
  let current = byId.get(id)?.parentId ?? null;
  while (current !== null) {
    if (visited.has(current)) break;
    visited.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    names.push(folder.name);
    current = folder.parentId;
  }
  return names.reverse();
}

function subtreeIds(folders: FolderRef[], rootId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const folder of folders) {
    const parentKey = folder.parentId ?? -1;
    const list = children.get(parentKey) ?? [];
    list.push(folder.id);
    children.set(parentKey, list);
  }
  const out = new Set<number>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    if (out.has(id)) continue;
    out.add(id);
    for (const childId of children.get(id) ?? []) stack.push(childId);
  }
  return out;
}

export function buildMoveTargets(folders: FolderRef[], active: MoveActive): MoveTarget[] {
  const excluded = active.kind === "folder" ? subtreeIds(folders, active.id) : new Set<number>();
  const byParent = new Map<number | null, FolderRef[]>();
  for (const folder of folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  const out: MoveTarget[] = [];
  function visit(parentId: number | null, path: string[]) {
    for (const folder of byParent.get(parentId) ?? []) {
      if (excluded.has(folder.id)) continue;
      const skipRow = active.kind === "bookmark" && folder.id === active.folderId;
      if (!skipRow) out.push({ id: folder.id, name: folder.name, path });
      visit(folder.id, [...path, folder.name]);
    }
  }
  visit(null, []);
  return out;
}

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function foldDiacritics(s: string): string {
  return s.normalize("NFKD").replace(COMBINING_MARKS, "");
}

export function normalizeQuery(s: string): string {
  return foldDiacritics(s.trim().toLocaleLowerCase("ru"));
}

export function filterTargets(targets: MoveTarget[], query: string): MoveTarget[] {
  const q = normalizeQuery(query);
  if (q === "") return targets;
  return targets.filter((t) => normalizeQuery(t.name).includes(q));
}
