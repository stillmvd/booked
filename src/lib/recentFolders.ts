export const RECENT_FOLDERS_KEY = "booked.quickAdd.recentFolders";
export const RECENT_FOLDERS_LIMIT = 4;

export type FolderChoice = number | null;

export function sanitizeRecent(raw: unknown): FolderChoice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<FolderChoice>();
  const out: FolderChoice[] = [];
  for (const item of raw) {
    const id = item === null || (Number.isInteger(item) && (item as number) > 0) ? (item as FolderChoice) : undefined;
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function pushRecentFolder(recent: FolderChoice[], id: FolderChoice, limit = RECENT_FOLDERS_LIMIT): FolderChoice[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, limit);
}

export function aliveRecent(recent: FolderChoice[], existing: ReadonlySet<number>): FolderChoice[] {
  return recent.filter((id) => id === null || existing.has(id));
}

export function folderPathNames(
  refs: ReadonlyArray<{ id: number; parentId: number | null; name: string }>,
  id: FolderChoice,
): string[] {
  if (id === null) return [];
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  const names: string[] = [];
  let ref = byId.get(id);
  while (ref && names.length <= refs.length) {
    names.unshift(ref.name);
    ref = ref.parentId === null ? undefined : byId.get(ref.parentId);
  }
  return names;
}

export function matchFolders<T extends { name: string }>(refs: ReadonlyArray<T>, query: string): T[] {
  const q = query.toLocaleLowerCase();
  if (!q) return [];
  return refs.filter((ref) => ref.name.toLocaleLowerCase().includes(q));
}

export function splitMatch(name: string, query: string): [string, string, string] {
  const i = query ? name.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  if (i < 0) return [name, "", ""];
  return [name.slice(0, i), name.slice(i, i + query.length), name.slice(i + query.length)];
}

export function tileFolders<T extends { id: number; bookmarkCount: number }>(
  recent: FolderChoice[],
  nodes: ReadonlyArray<T>,
  limit = RECENT_FOLDERS_LIMIT,
): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const picked = recent.flatMap((id) => (id === null ? [] : (byId.get(id) ?? [])));
  const rest = nodes.filter((node) => !picked.includes(node)).sort((a, b) => b.bookmarkCount - a.bookmarkCount);
  return [...picked, ...rest].slice(0, limit);
}
