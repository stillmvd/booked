import type { ReactNode } from "react";

import type { IconName } from "../components/Icon";

export interface MenuAction {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  indent?: boolean;
  icon?: ReactNode;
  glyph?: IconName;
  submenu?: MenuGroup[];
  onSelect: () => void;
}

export type MenuGroup = MenuAction[];

export interface CardMenuContext {
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onAddLinkFromClipboard: () => void;
  bookmarkUrl: string;
  onCheckLiveness: () => void;
  onRefreshPreview: () => void;
  onDelete: () => void;
  onOpenWithDefault: () => void;
  openWithBrowserGroups: MenuGroup[];
}

export interface FolderMenuContext {
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onNewBookmarkHere: () => void;
  onNewSubfolder: () => void;
  onDelete: () => void;
}

export interface CanvasMenuContext {
  onPasteAdd: () => void;
  onNewBookmark: () => void;
  onNewFolder: () => void;
  onDeleteCurrentFolder?: () => void;
}

function nonEmpty(groups: MenuGroup[]): MenuGroup[] {
  return groups.filter((g) => g.length > 0);
}

export function buildCardMenu(ctx: CardMenuContext): MenuGroup[] {
  const openWithGroups: MenuGroup[] = [
    [{ id: "open-with-default", label: "Браузер по умолчанию", glyph: "globe", onSelect: ctx.onOpenWithDefault }],
    ...ctx.openWithBrowserGroups,
  ];
  const openGroup: MenuGroup = [
    { id: "open", label: "Открыть", shortcut: "Enter", glyph: "arrow-up-right", onSelect: ctx.onOpen },
    { id: "open-with", label: "Открыть в…", glyph: "window", submenu: openWithGroups, onSelect: () => {} },
  ];
  const editGroup: MenuGroup = [
    { id: "edit", label: "Изменить…", shortcut: "F2", glyph: "edit", onSelect: ctx.onEdit },
    { id: "move", label: "Переместить в…", shortcut: "Ctrl+Shift+M", glyph: "move", onSelect: ctx.onMove },
    { id: "add-link-from-clipboard", label: "Добавить ссылку из буфера", glyph: "clipboard", onSelect: ctx.onAddLinkFromClipboard },
  ];
  const copyGroup: MenuGroup = [
    {
      id: "copy-link",
      label: "Копировать ссылку",
      glyph: "link",
      onSelect: () => {
        navigator.clipboard?.writeText(ctx.bookmarkUrl).catch(() => {});
      },
    },
    { id: "check-liveness", label: "Проверить сейчас", glyph: "pulse", onSelect: ctx.onCheckLiveness },
    { id: "refresh-preview", label: "Обновить превью", glyph: "image", onSelect: ctx.onRefreshPreview },
  ];
  const dangerGroup: MenuGroup = [
    { id: "delete", label: "Удалить", shortcut: "Del", glyph: "trash", danger: true, onSelect: ctx.onDelete },
  ];
  return nonEmpty([openGroup, editGroup, copyGroup, dangerGroup]);
}

export function buildFolderMenu(ctx: FolderMenuContext): MenuGroup[] {
  const openGroup: MenuGroup = [
    { id: "open", label: "Открыть", shortcut: "Enter", glyph: "arrow-up-right", onSelect: ctx.onOpen },
  ];
  const editGroup: MenuGroup = [
    { id: "edit", label: "Изменить…", shortcut: "F2", glyph: "edit", onSelect: ctx.onEdit },
    { id: "move", label: "Переместить в…", shortcut: "Ctrl+Shift+M", glyph: "move", onSelect: ctx.onMove },
    { id: "new-bookmark-here", label: "Новая закладка здесь", glyph: "bookmark", onSelect: ctx.onNewBookmarkHere },
    { id: "new-subfolder", label: "Новая подпапка", glyph: "folder-plus", onSelect: ctx.onNewSubfolder },
  ];
  const copyGroup: MenuGroup = [];
  const dangerGroup: MenuGroup = [
    { id: "delete", label: "Удалить", shortcut: "Del", glyph: "trash", danger: true, onSelect: ctx.onDelete },
  ];
  return nonEmpty([openGroup, editGroup, copyGroup, dangerGroup]);
}

export function buildCanvasMenu(ctx: CanvasMenuContext): MenuGroup[] {
  const group: MenuGroup = [
    { id: "paste-add", label: "Добавить из буфера", glyph: "clipboard", onSelect: ctx.onPasteAdd },
    { id: "new-bookmark", label: "Новая закладка", glyph: "bookmark", onSelect: ctx.onNewBookmark },
    { id: "new-folder", label: "Новая папка", glyph: "folder-plus", onSelect: ctx.onNewFolder },
  ];
  const dangerGroup: MenuGroup = ctx.onDeleteCurrentFolder
    ? [
        {
          id: "delete-current-folder",
          label: "Удалить эту папку",
          glyph: "trash",
          danger: true,
          onSelect: ctx.onDeleteCurrentFolder,
        },
      ]
    : [];
  return nonEmpty([group, dangerGroup]);
}

export interface GameMenuContext {
  installed: boolean;
  onLaunch: () => void;
  onPickExe: () => void;
  onEdit: () => void;
  onDeleteFolder: () => void;
  onForget: () => void;
}

export function buildGameMenu(ctx: GameMenuContext): MenuGroup[] {
  const launchGroup: MenuGroup = ctx.installed
    ? [
        { id: "launch", label: "Запустить", glyph: "play", onSelect: ctx.onLaunch },
        { id: "pick-exe", label: "Чем запускать…", glyph: "file", onSelect: ctx.onPickExe },
      ]
    : [];
  const editGroup: MenuGroup = [{ id: "edit", label: "Изменить…", shortcut: "F2", glyph: "edit", onSelect: ctx.onEdit }];
  const dangerGroup: MenuGroup = [
    ...(ctx.installed
      ? [{ id: "delete-folder", label: "Удалить с диска", glyph: "trash" as const, danger: true, onSelect: ctx.onDeleteFolder }]
      : []),
    { id: "forget", label: "Убрать из списка", glyph: "minus-circle", danger: true, onSelect: ctx.onForget },
  ];
  return nonEmpty([launchGroup, editGroup, dangerGroup]);
}
