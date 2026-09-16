import { pluralizeRu } from "./pluralizeRu.ts";
import type { ImportMode } from "./types.ts";

const FOLDER_FORMS: [string, string, string] = ["папка", "папки", "папок"];
const BOOKMARK_FORMS: [string, string, string] = ["закладка", "закладки", "закладок"];

export const RESTORE_MODES: ReadonlyArray<{ mode: ImportMode; title: string; description: string }> = [
  { mode: "merge", title: "Слить с текущим", description: "Закладки из копии добавятся к нынешним, ничего не пропадёт" },
  { mode: "replace", title: "Заменить всё", description: "Booked сотрёт нынешние закладки и оставит только копию" },
];

export function folderCount(n: number): string {
  return `${n} ${pluralizeRu(n, FOLDER_FORMS)}`;
}

export function bookmarkCount(n: number): string {
  return `${n} ${pluralizeRu(n, BOOKMARK_FORMS)}`;
}

export function tileNote(bookmarks: number, folders: number): string {
  return `${pluralizeRu(bookmarks, BOOKMARK_FORMS)} · ${folderCount(folders)}`;
}

export function importedText(folders: number, bookmarks: number): string {
  return `Импортировано: ${folderCount(folders)}, ${bookmarkCount(bookmarks)}`;
}

export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function modeByKey(current: ImportMode, key: string): ImportMode | null {
  const modes = RESTORE_MODES.map((m) => m.mode);
  const index = modes.indexOf(current);
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return modes[(index + 1) % modes.length];
    case "ArrowUp":
    case "ArrowLeft":
      return modes[(index - 1 + modes.length) % modes.length];
    case "Home":
      return modes[0];
    case "End":
      return modes[modes.length - 1];
    default:
      return null;
  }
}
