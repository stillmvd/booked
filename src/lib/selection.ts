import { pluralizeRu } from "./pluralizeRu.ts";

export interface Selection {
  ids: Set<string>;
  anchor: string | null;
}

export const EMPTY: Selection = { ids: new Set(), anchor: null };

export function toggle(selection: Selection, id: string): Selection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id };
}

export function rangeTo(selection: Selection, id: string, orderedIds: string[]): Selection {
  const anchor = selection.anchor ?? id;
  const from = orderedIds.indexOf(anchor);
  const to = orderedIds.indexOf(id);
  if (from === -1 || to === -1) return { ids: new Set([id]), anchor: id };
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return { ids: new Set(orderedIds.slice(lo, hi + 1)), anchor };
}

export function selectAll(orderedIds: string[]): Selection {
  return { ids: new Set(orderedIds), anchor: orderedIds[0] ?? null };
}

export function counts(ids: Set<string>): { bookmarks: number; folders: number } {
  let bookmarks = 0;
  let folders = 0;
  for (const id of ids) {
    if (id.startsWith("b")) bookmarks++;
    else if (id.startsWith("f")) folders++;
  }
  return { bookmarks, folders };
}

export function splitIds(ids: Set<string>): { bookmarkIds: number[]; folderIds: number[] } {
  const bookmarkIds: number[] = [];
  const folderIds: number[] = [];
  for (const id of ids) {
    const n = Number(id.slice(1));
    if (!Number.isFinite(n)) continue;
    if (id.startsWith("b")) bookmarkIds.push(n);
    else if (id.startsWith("f")) folderIds.push(n);
  }
  return { bookmarkIds, folderIds };
}

const BOOKMARK_FORMS: [string, string, string] = ["закладка", "закладки", "закладок"];
const FOLDER_FORMS: [string, string, string] = ["папка", "папки", "папок"];

export function countsPhrase(ids: Set<string>): string {
  const { bookmarks, folders } = counts(ids);
  const parts: string[] = [];
  if (bookmarks > 0) parts.push(`${bookmarks} ${pluralizeRu(bookmarks, BOOKMARK_FORMS)}`);
  if (folders > 0) parts.push(`${folders} ${pluralizeRu(folders, FOLDER_FORMS)}`);
  return parts.join(" и ");
}

export function summaryText(ids: Set<string>): string {
  const { bookmarks, folders } = counts(ids);
  const verb = bookmarks + folders === 1 ? "Выбрана" : "Выбрано";
  return `${verb} ${countsPhrase(ids)}`;
}
