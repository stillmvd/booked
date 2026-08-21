export type FieldName = "url" | "title" | "image";

export type DirtySet = ReadonlySet<FieldName>;

export interface FieldValues {
  url: string;
  title: string;
  image: string | null;
}

export function markDirty(set: DirtySet, field: FieldName): DirtySet {
  if (set.has(field)) return set;
  const next = new Set(set);
  next.add(field);
  return next;
}

export function isDirty(set: DirtySet, field: FieldName): boolean {
  return set.has(field);
}

export function applyFetched(
  current: FieldValues,
  fetched: Partial<FieldValues>,
  dirty: DirtySet,
): FieldValues {
  const next: FieldValues = { ...current };
  (Object.keys(current) as FieldName[]).forEach((field) => {
    if (isDirty(dirty, field)) return;
    const value = fetched[field];
    if (value) next[field] = value;
  });
  return next;
}

export function fallbackTitle(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = parsed.host.startsWith("www.") ? parsed.host.slice(4) : parsed.host;
  const segment = parsed.pathname.split("/").filter(Boolean)[0];
  return segment ? `${host}/${segment}` : host;
}
