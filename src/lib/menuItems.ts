import type { ReactNode } from "react";

export interface MenuAction {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  indent?: boolean;
  icon?: ReactNode;
  submenu?: MenuGroup[];
  onSelect: () => void;
}

export type MenuGroup = MenuAction[];

export interface CardMenuContext {
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
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
}

function nonEmpty(groups: MenuGroup[]): MenuGroup[] {
  return groups.filter((g) => g.length > 0);
}

export function buildCardMenu(ctx: CardMenuContext): MenuGroup[] {
  const openWithGroups: MenuGroup[] = [
    [{ id: "open-with-default", label: "Браузер по умолчанию", onSelect: ctx.onOpenWithDefault }],
    ...ctx.openWithBrowserGroups,
  ];
  const openGroup: MenuGroup = [
    { id: "open", label: "Открыть", shortcut: "Enter", onSelect: ctx.onOpen },
    { id: "open-with", label: "Открыть в…", submenu: openWithGroups, onSelect: () => {} },
  ];
  const editGroup: MenuGroup = [
    { id: "edit", label: "Изменить…", shortcut: "F2", onSelect: ctx.onEdit },
    { id: "move", label: "Переместить в…", shortcut: "Ctrl+Shift+M", onSelect: ctx.onMove },
  ];
  const copyGroup: MenuGroup = [
    {
      id: "copy-link",
      label: "Копировать ссылку",
      onSelect: () => {
        navigator.clipboard?.writeText(ctx.bookmarkUrl).catch(() => {});
      },
    },
    { id: "check-liveness", label: "Проверить сейчас", onSelect: ctx.onCheckLiveness },
    { id: "refresh-preview", label: "Обновить превью", onSelect: ctx.onRefreshPreview },
  ];
  const dangerGroup: MenuGroup = [{ id: "delete", label: "Удалить", shortcut: "Del", danger: true, onSelect: ctx.onDelete }];
  return nonEmpty([openGroup, editGroup, copyGroup, dangerGroup]);
}

export function buildFolderMenu(ctx: FolderMenuContext): MenuGroup[] {
  const openGroup: MenuGroup = [{ id: "open", label: "Открыть", shortcut: "Enter", onSelect: ctx.onOpen }];
  const editGroup: MenuGroup = [
    { id: "edit", label: "Изменить…", shortcut: "F2", onSelect: ctx.onEdit },
    { id: "move", label: "Переместить в…", shortcut: "Ctrl+Shift+M", onSelect: ctx.onMove },
    { id: "new-bookmark-here", label: "Новая закладка здесь", onSelect: ctx.onNewBookmarkHere },
    { id: "new-subfolder", label: "Новая подпапка", onSelect: ctx.onNewSubfolder },
  ];
  const copyGroup: MenuGroup = [];
  const dangerGroup: MenuGroup = [{ id: "delete", label: "Удалить", shortcut: "Del", danger: true, onSelect: ctx.onDelete }];
  return nonEmpty([openGroup, editGroup, copyGroup, dangerGroup]);
}

export function buildCanvasMenu(ctx: CanvasMenuContext): MenuGroup[] {
  const group: MenuGroup = [
    { id: "paste-add", label: "Добавить из буфера", onSelect: ctx.onPasteAdd },
    { id: "new-bookmark", label: "Новая закладка", onSelect: ctx.onNewBookmark },
    { id: "new-folder", label: "Новая папка", onSelect: ctx.onNewFolder },
  ];
  return nonEmpty([group]);
}
