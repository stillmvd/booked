import { formatSize, splitExePath } from "./gameFormat.ts";
import { pluralizeRu } from "./pluralizeRu.ts";
import type { Game, GameMatchReasons, GameVersionGroup } from "./types.ts";

const SOURCE_NAMES: Record<string, string> = { f95: "F95", itch: "itch.io" };
const COUNT_WORDS = ["", "", "Две", "Три", "Четыре", "Пять", "Шесть", "Семь", "Восемь", "Девять"];

export function matchLine(reasons: GameMatchReasons | null): string {
  if (!reasons) return "совпадений не нашлось — проверьте, что это одна игра";
  const parts = [
    reasons.name ? "имя папки" : "",
    reasons.exe ?? "",
    reasons.exe && reasons.engine ? reasons.engine : "",
    reasons.page ? `страница ${SOURCE_NAMES[reasons.page] ?? reasons.page}` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "каждая папка совпала с другими по своему признаку";
  if (parts.length > 1) return `совпали ${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
  if (reasons.name) return "совпало имя папки";
  if (reasons.page) return `совпала ${parts[0]}`;
  return `совпал ${parts[0]}`;
}

export function reasonPhrase(reasons: GameMatchReasons | null): string {
  if (!reasons) return "Совпадений не нашлось";
  const parts = [
    reasons.name ? "имя папки" : "",
    reasons.exe ? "exe" : "",
    reasons.page ? `страница ${SOURCE_NAMES[reasons.page] ?? reasons.page}` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "Папки похожи по разным признакам";
  if (parts.length > 1) return `Совпали ${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
  if (reasons.name) return "Совпало имя папки";
  if (reasons.exe) return "Совпал exe";
  return `Совпала ${parts[0]}`;
}

export function openGroups(versions: GameVersionGroup[], pending: ReadonlySet<number>, known: ReadonlySet<number>): GameVersionGroup[] {
  return versions.filter((group) => group.ids.every((id) => known.has(id) && !pending.has(id)));
}

export function newestIds(groups: GameVersionGroup[]): Map<number, GameVersionGroup> {
  const marks = new Map<number, GameVersionGroup>();
  for (const group of groups) {
    const newest = group.ids[group.ids.length - 1];
    if (newest !== undefined && !marks.has(newest)) marks.set(newest, group);
  }
  return marks;
}

export function versionOf(game: Game | undefined): string {
  if (!game) return "";
  return game.versionInstalled ?? game.folderName ?? game.title;
}

export function noteTitle(group: GameVersionGroup, games: ReadonlyMap<number, Game>): { title: string; versions: string } {
  const first = games.get(group.ids[0]);
  const last = games.get(group.ids[group.ids.length - 1]);
  const from = first?.versionInstalled ?? "";
  const to = last?.versionInstalled ?? "";
  if (!from || !to) return { title: first?.title ?? "", versions: "" };
  if (from === to) {
    const count = group.ids.length;
    return { title: first?.title ?? "", versions: `${from} · ${count} ${pluralizeRu(count, ["копия", "копии", "копий"])}` };
  }
  return { title: first?.title ?? "", versions: `${from} → ${to}` };
}

export function noteSubline(group: GameVersionGroup, others: number): string {
  const phrase = reasonPhrase(group.reasons);
  return others > 0 ? `${phrase} · и ещё ${others} ${pluralizeRu(others, ["игра", "игры", "игр"])}` : phrase;
}

export function windowTitle(count: number, title: string): string {
  if (count <= 2) return "Какую папку оставить?";
  return `${COUNT_WORDS[count] ?? count} ${pluralizeRu(count, ["версия", "версии", "версий"])} ${title}`;
}

export function mergeVerb(kept: Game | undefined, count: number, keepsNewest: boolean): string {
  if (count > 2) return `Оставить ${versionOf(kept)}`;
  if (!keepsNewest) return "Оставить старую";
  return kept?.versionInstalled ? `Обновить до ${kept.versionInstalled}` : "Обновить";
}

export function toastText(survivor: Game | undefined, kept: Game | undefined): string {
  const title = survivor?.title ?? "Игра";
  return kept?.versionInstalled ? `${title} обновлена до ${kept.versionInstalled}` : `${title}: осталась одна папка`;
}

export function savesFact(leavingSaves: number, keptSaves: number, keepsNewest: boolean): string {
  if (leavingSaves > 0) {
    const files = `${leavingSaves} ${pluralizeRu(leavingSaves, ["файл", "файла", "файлов"])}`;
    const [from, to] = keepsNewest ? ["старой", "новую"] : ["новой", "старую"];
    return `Сохранения из ${from} папки (${files}) перенесутся в ${to}, если их там нет или они новее`;
  }
  if (keptSaves > 0) return "В папке, которая уйдёт в Корзину, сохранений нет — переносить нечего";
  return "Сохранений в папках нет — переносить нечего";
}

export function savesLabel(count: number | undefined, onDisk: boolean): string {
  if (!onDisk) return "—";
  if (!count) return "нет в папке";
  return `${count} ${pluralizeRu(count, ["файл", "файла", "файлов"])}`;
}

export function trashLine(folderName: string, bytes: number, saves: number): string {
  const size = formatSize(bytes);
  const head = size ? `${folderName} уйдёт в Корзину · ${size}.` : `${folderName} уйдёт в Корзину.`;
  const tail = saves > 0
    ? ` Сохранения из неё (${saves} ${pluralizeRu(saves, ["файл", "файла", "файлов"])}) скопируются, если их нет или они новее.`
    : " Сохранений в ней нет.";
  return head + tail;
}

export function permanentQuestion(folder: string, bytes: number): string {
  const size = formatSize(bytes);
  return size ? `Корзина не примет ${size}` : `Корзина не примет папку ${folder}`;
}

export function changedLabel(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return "—";
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: sameYear ? undefined : "numeric" }).format(date);
}

export function exeLabel(game: Game): string {
  return game.exePath ? splitExePath(game.exePath).name : "—";
}

export function rowSubline(game: Game, bytes: number | null, modified: number | null, now: number = Date.now()): string {
  return [
    game.versionInstalled ?? "",
    bytes === null ? "" : formatSize(bytes),
    modified === null ? "" : `изменена ${changedLabel(modified, now)}`,
    game.pageUrl ? `страница ${game.source ? (SOURCE_NAMES[game.source] ?? game.source) : ""}`.trim() : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function leavingLine(folders: Array<{ name: string; bytes: number; saves: number }>): string {
  if (folders.length === 0) return "Старой папки нет на диске — в Корзину ничего не уйдёт.";
  if (folders.length === 1) return trashLine(folders[0].name, folders[0].bytes, folders[0].saves);
  const total = formatSize(folders.reduce((sum, folder) => sum + folder.bytes, 0));
  return `${folders.length} ${pluralizeRu(folders.length, ["папка уйдёт", "папки уйдут", "папок уйдут"])} в Корзину · ${total}. Сохранения из них скопируются, если их нет или они новее.`;
}

export const DATA_LINE = "Оценка, статус, обложка, страница и теги соберутся в одной карточке.";
