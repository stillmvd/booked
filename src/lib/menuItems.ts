import type { MenuAction, MenuGroup } from "../components/ContextMenu";

export type { MenuAction, MenuGroup };

export interface CardMenuContext {
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onCopyLink: () => void;
  onCheckLiveness: () => void;
  onRefreshPreview: () => void;
  onDelete: () => void;
  openWithGroups: MenuGroup[];
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

export function buildCardMenu(_ctx: CardMenuContext): MenuGroup[] {
  throw new Error("not implemented");
}

export function buildFolderMenu(_ctx: FolderMenuContext): MenuGroup[] {
  throw new Error("not implemented");
}

export function buildCanvasMenu(_ctx: CanvasMenuContext): MenuGroup[] {
  throw new Error("not implemented");
}
