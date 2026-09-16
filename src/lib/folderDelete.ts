import { pluralizeRu } from "./pluralizeRu.ts";
import { bookmarkCount } from "./restore.ts";
import type { ContentsCount, DeleteMode } from "./types.ts";

const SUBFOLDER_FORMS: [string, string, string] = ["подпапка", "подпапки", "подпапок"];
const REMOVED_FORMS: [string, string, string] = ["удалится", "удалятся", "удалятся"];

export function contentsChips(count: ContentsCount): string[] {
  const chips: string[] = [];
  if (count.bookmarks > 0) chips.push(bookmarkCount(count.bookmarks));
  if (count.folders > 0) chips.push(`${count.folders} ${pluralizeRu(count.folders, SUBFOLDER_FORMS)}`);
  return chips;
}

export function folderDeleteModes(
  count: ContentsCount,
  parentName: string | null,
): Array<{ value: DeleteMode; title: string; description: string; risk?: boolean }> {
  const both = count.bookmarks > 0 && count.folders > 0;
  const removed = pluralizeRu(both ? 2 : count.bookmarks || count.folders, REMOVED_FORMS);
  return [
    {
      value: "promote",
      title: `Перенести в «${parentName ?? "Booked"}»`,
      description: "Содержимое переедет, исчезнет только сама папка",
    },
    {
      value: "all",
      title: "Удалить с содержимым",
      description: `${contentsChips(count).join(" и ")} ${removed} вместе с папкой`,
      risk: true,
    },
  ];
}
