const GAME_HOSTS = ["f95zone.to", "itch.io"];

export function pageUrlProblem(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  let host: string;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    host = parsed.hostname.toLowerCase();
  } catch {
    return "Это не похоже на ссылку — скопируйте адрес страницы игры целиком.";
  }
  const known = GAME_HOSTS.some((site) => host === site || host.endsWith(`.${site}`));
  return known ? null : "Нужна ссылка на страницу игры на F95zone или itch.io.";
}

export function sourceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export const ARCHIVE_EXTENSIONS = ["zip", "rar", "7z"];

export function isArchivePath(path: string): boolean {
  return /\.(zip|rar|7z)$/i.test(path);
}
