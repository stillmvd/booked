import { createContext } from "react";

export interface DragTarget {
  overTreeFolderId: number | null | undefined;
  allowed: boolean;
  dragging: boolean;
}

export const DragTargetContext = createContext<DragTarget>({
  overTreeFolderId: undefined,
  allowed: false,
  dragging: false,
});
