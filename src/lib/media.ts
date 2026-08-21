export function previewRelPath(file: string): string[] {
  return ["previews", file.slice(0, 2), file];
}

export function iconRelPath(file: string): string[] {
  return ["icons", file];
}

export function mediaSrcOf(input: {
  image: string | null;
  previewFile: string | null;
}): string[] | null {
  if (input.image) return ["images", input.image];
  if (input.previewFile) return previewRelPath(input.previewFile);
  return null;
}
