import { pluralizeRu } from "./pluralizeRu.ts";

export const SEARCH_PAGE = 40;

const RESULT_FORMS: [one: string, few: string, many: string] = ["результат", "результата", "результатов"];

function cleanQuery(query: string): string {
  return query.split('"').join("").split("*").join("").trim();
}

function tagsList(tags: string[]): string {
  if (tags.length === 0) return "";
  if (tags.length === 1) return tags[0];
  if (tags.length === 2) return `${tags[0]} или ${tags[1]}`;
  const head = tags.slice(0, -1).join(", ");
  const last = tags[tags.length - 1];
  return `${head} или ${last}`;
}

export interface SummaryParts {
  word: string;
  query: string;
  tags: string;
}

export function summaryParts(total: number, query: string, tags: string[]): SummaryParts {
  const cleanedQuery = cleanQuery(query);
  return {
    word: pluralizeRu(total, RESULT_FORMS),
    query: cleanedQuery === "" ? "" : `«${cleanedQuery}»`,
    tags: tagsList(tags.map(cleanQuery)),
  };
}

export function summaryText(total: number, query: string, tags: string[]): string {
  const { word, query: quoted, tags: tagText } = summaryParts(total, query, tags);
  const parts = [quoted, tagText].filter((part) => part !== "");
  const count = `${total} ${word}`;
  if (parts.length === 0) return count;
  return `${count} · ${parts.join(" · ")}`;
}

export interface NarrowingInput {
  scopeFolderId: number | null;
  currentFolderId: number | null;
  currentFolderName: string | null;
  total: number;
  totalGlobal: number;
  inCurrentFolder: number;
}

export type NarrowingState =
  | { kind: "none" }
  | { kind: "narrow-offer"; count: number; folderName: string }
  | { kind: "escalate"; outsideCount: number; folderName: string };

export function narrowingState(input: NarrowingInput): NarrowingState {
  const { scopeFolderId, currentFolderId, currentFolderName, total, totalGlobal, inCurrentFolder } = input;

  if (
    scopeFolderId === null &&
    currentFolderId !== null &&
    currentFolderName !== null &&
    inCurrentFolder > 0 &&
    inCurrentFolder < total
  ) {
    return { kind: "narrow-offer", count: inCurrentFolder, folderName: currentFolderName };
  }

  if (scopeFolderId !== null && total === 0 && totalGlobal > 0 && currentFolderName !== null) {
    return { kind: "escalate", outsideCount: totalGlobal - total, folderName: currentFolderName };
  }

  return { kind: "none" };
}

export function hasMore(shown: number, total: number): boolean {
  return shown < total;
}
