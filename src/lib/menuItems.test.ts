import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCanvasMenu, buildCardMenu, buildFolderMenu, buildGameMenu } from "./menuItems.ts";
import type { CanvasMenuContext, CardMenuContext, FolderMenuContext, GameMenuContext } from "./menuItems.ts";

function noop() {}

function cardCtx(overrides: Partial<CardMenuContext> = {}): CardMenuContext {
  return {
    onOpen: noop,
    onEdit: noop,
    onMove: noop,
    bookmarkUrl: "https://example.com/",
    onCheckLiveness: noop,
    onRefreshPreview: noop,
    onDelete: noop,
    onOpenWithDefault: noop,
    openWithBrowserGroups: [],
    ...overrides,
  };
}

function folderCtx(overrides: Partial<FolderMenuContext> = {}): FolderMenuContext {
  return {
    onOpen: noop,
    onEdit: noop,
    onMove: noop,
    onNewBookmarkHere: noop,
    onNewSubfolder: noop,
    onDelete: noop,
    ...overrides,
  };
}

function canvasCtx(overrides: Partial<CanvasMenuContext> = {}): CanvasMenuContext {
  return {
    onPasteAdd: noop,
    onNewBookmark: noop,
    onNewFolder: noop,
    ...overrides,
  };
}

test("buildCardMenu: ровно восемь пунктов, распределённых по четырём группам, последний — разрушительный", () => {
  const groups = buildCardMenu(cardCtx());
  const flat = groups.flat();
  assert.equal(flat.length, 8);
  assert.equal(groups.length, 4);
  assert.equal(flat[flat.length - 1].danger, true);
  assert.equal(flat[flat.length - 1].id, "delete");
});

test("buildFolderMenu: ровно шесть пунктов, последний — разрушительный", () => {
  const groups = buildFolderMenu(folderCtx());
  const flat = groups.flat();
  assert.equal(flat.length, 6);
  assert.equal(flat[flat.length - 1].danger, true);
});

test("buildCanvasMenu: в корне три пункта, ни одного разрушительного", () => {
  const groups = buildCanvasMenu(canvasCtx());
  const flat = groups.flat();
  assert.equal(flat.length, 3);
  assert.ok(flat.every((item) => !item.danger));
  assert.ok(!flat.some((item) => item.id === "delete-current-folder"));
});

test("buildCanvasMenu: внутри папки последний пункт — удаление этой папки, помеченное опасным", () => {
  const groups = buildCanvasMenu(canvasCtx({ onDeleteCurrentFolder: noop }));
  const flat = groups.flat();
  assert.equal(flat.length, 4);
  assert.equal(flat[flat.length - 1].id, "delete-current-folder");
  assert.equal(flat[flat.length - 1].label, "Удалить эту папку");
  assert.equal(flat[flat.length - 1].danger, true);
  assert.equal(groups.length, 2, "удаление стоит отдельной группой");
});

test("билдеры не помечают пункты недоступными — неприменимое отсутствует, а не задизейблено", () => {
  const flat = buildCardMenu(cardCtx()).flat();
  assert.ok(flat.every((item) => !("disabled" in item)));
});

test("билдер со схлопнутой пустой группой не возвращает эту группу (у папки нет группы «копировать»)", () => {
  const groups = buildFolderMenu(folderCtx());
  assert.ok(groups.every((g) => g.length > 0));
  assert.equal(groups.length, 3);
});

test("пункт с подменю в составе карточки ровно один", () => {
  const flat = buildCardMenu(cardCtx()).flat();
  const withSubmenu = flat.filter((item) => item.submenu);
  assert.equal(withSubmenu.length, 1);
  assert.equal(withSubmenu[0].id, "open-with");
});

test("плашка шортката стоит ровно у четырёх пунктов карточки и ни у одного пункта холста", () => {
  const cardFlat = buildCardMenu(cardCtx()).flat();
  assert.equal(cardFlat.filter((item) => item.shortcut).length, 4);
  const canvasFlat = buildCanvasMenu(canvasCtx()).flat();
  assert.equal(canvasFlat.filter((item) => item.shortcut).length, 0);
});

test("у пункта копирования ссылки плашки шортката нет", () => {
  const flat = buildCardMenu(cardCtx()).flat();
  const copyLink = flat.find((item) => item.id === "copy-link");
  assert.ok(copyLink);
  assert.equal(copyLink!.shortcut, undefined);
});

test("ни в одном пункте нет числовой подписи и подстановки в тексте", () => {
  const all = [...buildCardMenu(cardCtx()).flat(), ...buildFolderMenu(folderCtx()).flat(), ...buildCanvasMenu(canvasCtx()).flat()];
  for (const item of all) {
    assert.ok(!/\d/.test(item.label), `лейбл содержит цифру: ${item.label}`);
  }
});

test("состав, полученный дважды на одних и тех же данных, совпадает по порядку пунктов", () => {
  const ctx = cardCtx();
  const first = buildCardMenu(ctx).flat().map((i) => i.id);
  const second = buildCardMenu(ctx).flat().map((i) => i.id);
  assert.deepEqual(first, second);
});

test("тексты пунктов карточки дословно совпадают с копирайтинг-контрактом", () => {
  const flat = buildCardMenu(cardCtx()).flat();
  assert.deepEqual(
    flat.map((i) => i.label),
    [
      "Открыть",
      "Открыть в…",
      "Изменить…",
      "Переместить в…",
      "Копировать ссылку",
      "Проверить сейчас",
      "Обновить превью",
      "Удалить",
    ],
  );
});

test("тексты пунктов папки дословно совпадают с копирайтинг-контрактом", () => {
  const flat = buildFolderMenu(folderCtx()).flat();
  assert.deepEqual(
    flat.map((i) => i.label),
    ["Открыть", "Изменить…", "Переместить в…", "Новая закладка здесь", "Новая подпапка", "Удалить"],
  );
});

test("тексты пунктов холста дословно совпадают с копирайтинг-контрактом", () => {
  const flat = buildCanvasMenu(canvasCtx()).flat();
  assert.deepEqual(flat.map((i) => i.label), ["Добавить из буфера", "Новая закладка", "Новая папка"]);
});

function gameCtx(overrides: Partial<GameMenuContext> = {}): GameMenuContext {
  return {
    installed: true,
    onLaunch: noop,
    onPickExe: noop,
    onDeleteFolder: noop,
    onForget: noop,
    ...overrides,
  };
}

test("меню установленной игры даёт запуск, выбор файла и оба удаления", () => {
  const flat = buildGameMenu(gameCtx()).flat();
  assert.deepEqual(
    flat.map((i) => i.label),
    ["Запустить", "Чем запускать…", "Удалить с диска", "Убрать из списка"],
  );
});

test("у игры без папки остаётся только «Убрать из списка»", () => {
  const groups = buildGameMenu(gameCtx({ installed: false }));
  assert.deepEqual(groups.flat().map((i) => i.label), ["Убрать из списка"]);
  assert.equal(groups.length, 1);
});

test("оба удаления помечены опасными", () => {
  const flat = buildGameMenu(gameCtx()).flat();
  assert.deepEqual(
    flat.filter((i) => i.danger).map((i) => i.id),
    ["delete-folder", "forget"],
  );
});
