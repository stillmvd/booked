const IMAGE_TYPE = /^image\//;

export function pickImageFile(list: FileList | null | undefined, items?: DataTransferItemList | null): File | null {
  for (const file of Array.from(list ?? [])) {
    if (IMAGE_TYPE.test(file.type)) return file;
  }
  for (const item of Array.from(items ?? [])) {
    if (item.kind !== "file" || !IMAGE_TYPE.test(item.type)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

export function pickImageUrl(uriList: string, text: string): string | null {
  const fromList = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  const candidate = fromList || text.trim();
  if (!candidate) return null;
  if (!/^https?:\/\/\S+$/i.test(candidate)) return null;
  return candidate;
}

export interface DropData {
  files?: FileList | null;
  items?: DataTransferItemList | null;
  uriList: string;
  text: string;
  html: string;
}

export type DropPick =
  | { kind: "file"; file: File }
  | { kind: "imageUrl"; url: string }
  | { kind: "link"; url: string }
  | { kind: "none" };

export type ImagePick = Extract<DropPick, { kind: "file" | "imageUrl" }>;

export function asImagePick(pick: DropPick): ImagePick | null {
  return pick.kind === "file" || pick.kind === "imageUrl" ? pick : null;
}

type DragItem = { kind: string; type: string };

function fileItems(items: ArrayLike<DragItem> | null | undefined): DragItem[] {
  return Array.from(items ?? []).filter((item) => item.kind === "file");
}

export function carriesImage(types: readonly string[], items?: ArrayLike<DragItem> | null): boolean {
  const files = fileItems(items);
  if (files.some((item) => IMAGE_TYPE.test(item.type))) return true;
  if (!types.includes("Files") || !types.includes("text/html")) return false;
  return !files.some((item) => item.type !== "" && !IMAGE_TYPE.test(item.type));
}

export function onlyImageFiles(items?: ArrayLike<DragItem> | null): boolean {
  const files = fileItems(items);
  return files.length > 0 && files.every((item) => IMAGE_TYPE.test(item.type));
}

export function imageInHtml(html: string): string | null {
  const match = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(html);
  const src = (match?.[1] ?? match?.[2] ?? "").trim().replace(/&amp;/g, "&");
  return /^https?:\/\/\S+$/i.test(src) ? src : null;
}

export function classifyDrop(data: DropData): DropPick {
  const file = pickImageFile(data.files, data.items);
  if (file) return { kind: "file", file };
  const fromHtml = imageInHtml(data.html);
  if (fromHtml) return { kind: "imageUrl", url: fromHtml };
  const url = pickImageUrl(data.uriList, data.text);
  if (!url) return { kind: "none" };
  return looksLikeImageUrl(url) ? { kind: "imageUrl", url } : { kind: "link", url };
}

export function looksLikeImageUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path);
}
