import type { PreviewOrigin } from "./types";

export function previewRelPath(file: string): string[] {
  return ["previews", file.slice(0, 2), file];
}

export function iconRelPath(file: string): string[] {
  return ["icons", file];
}

export function avatarRelPath(file: string): string[] {
  return ["avatars", file];
}

function isIconOrigin(origin: PreviewOrigin | null | undefined): boolean {
  return origin === "apple-touch" || origin === "favicon";
}

export function mediaSrcOf(input: {
  image: string | null;
  previewFile: string | null;
  previewOrigin?: PreviewOrigin | null;
}): string[] | null {
  if (input.image) return ["images", input.image];
  if (input.previewFile) {
    return isIconOrigin(input.previewOrigin) ? iconRelPath(input.previewFile) : previewRelPath(input.previewFile);
  }
  return null;
}

export type ThumbRenderMode = "preview" | "icon-large" | "icon-small" | "plate";

export function thumbRenderMode(input: {
  image: string | null;
  previewFile: string | null;
  previewOrigin: PreviewOrigin | null;
}): ThumbRenderMode {
  if (input.image) return "preview";
  if (!input.previewFile) return "plate";
  if (input.previewOrigin === "apple-touch") return "icon-large";
  if (input.previewOrigin === "favicon") return "icon-small";
  return "preview";
}
