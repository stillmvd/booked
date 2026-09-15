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

export function folderChips(
  recent: FolderChoice[],
  selected: FolderChoice,
  limit = RECENT_FOLDERS_LIMIT,
): FolderChoice[] {
  const base = recent.length > 0 ? recent : [null];
  if (base.includes(selected)) return base.slice(0, limit);
  return [selected, ...base].slice(0, limit);
}
