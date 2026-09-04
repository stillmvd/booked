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

export function looksLikeImageUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path);
}
