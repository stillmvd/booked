import { hostOf } from "./plate.ts";
import type { Bookmark, Folder } from "./types.ts";

export type SortKey = "name" | "host" | "added" | "tags";
export type SortDir = "asc" | "desc";

function applyDir(cmp: number, dir: SortDir): number {
  return dir === "asc" ? cmp : -cmp;
}

export function sortBookmarks(rows: Bookmark[], key: SortKey, dir: SortDir): Bookmark[] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = a.title.localeCompare(b.title, "ru");
        break;
      case "host":
        cmp = hostOf(a.urlNormalized).localeCompare(hostOf(b.urlNormalized), "ru");
        break;
      case "added":
        cmp = a.createdAt - b.createdAt;
        break;
      case "tags":
        cmp = a.tags.length - b.tags.length;
        break;
    }
    return applyDir(cmp, dir);
  });
}

export function sortFolders(rows: Folder[], key: SortKey, dir: SortDir): Folder[] {
  return [...rows].sort((a, b) => {
    const cmp = key === "tags" ? a.tags.length - b.tags.length : a.name.localeCompare(b.name, "ru");
    return applyDir(cmp, dir);
  });
}
