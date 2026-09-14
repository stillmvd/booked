import { displayLabel, platformForUrl } from "./platforms.ts";
import type { BookmarkLink, LinkInput, LinkStatus } from "./types.ts";

export interface EditableLink {
  key: string;
  url: string;
  label: string | null;
  linkStatus: LinkStatus | null;
}

let nextKey = 0;

function freshKey(): string {
  nextKey += 1;
  return `new-${nextKey}`;
}

export function fromBookmarkLinks(links: readonly BookmarkLink[]): EditableLink[] {
  return links.map((link) => ({ key: `id-${link.id}`, url: link.url, label: link.label, linkStatus: link.linkStatus }));
}

export function toLinkInputs(links: readonly EditableLink[]): LinkInput[] {
  return links.map((link) => ({ url: link.url, label: link.label }));
}

export function normalizeLinkInput(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const attempts = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? [trimmed] : [`https://${trimmed}`];
  for (const attempt of attempts) {
    try {
      const parsed = new URL(attempt);
      const httpish = parsed.protocol === "http:" || parsed.protocol === "https:";
      if (httpish && (parsed.hostname.includes(".") || parsed.hostname === "localhost")) return attempt;
    } catch {
      continue;
    }
  }
  return null;
}

export const TRACKING_PARAMS = ["fbclid", "gclid", "ref", "yclid"];

export function normalizedUrl(candidate: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^www\./, "");
  const port = parsed.port ? `:${parsed.port}` : "";
  const pairs = [...parsed.searchParams].filter(([key]) => !key.startsWith("utm_") && !TRACKING_PARAMS.includes(key));
  const query = pairs.length ? `?${pairs.map(([key, value]) => (value ? `${key}=${value}` : key)).join("&")}` : "";
  const hashAt = parsed.href.indexOf("#");
  const fragment = hashAt >= 0 ? parsed.href.slice(hashAt) : "";
  let path = parsed.pathname;
  if (path === "/") {
    if (!query && !fragment) path = "";
  } else if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return `${parsed.protocol}//${host}${port}${path}${query}${fragment}`;
}

export function sameUrl(a: string, b: string): boolean {
  return (normalizedUrl(a) ?? a.trim()) === (normalizedUrl(b) ?? b.trim());
}

export type AddResult = { ok: true; links: EditableLink[]; added: EditableLink } | { ok: false; reason: string };

export function addLink(links: readonly EditableLink[], candidate: string): AddResult {
  const url = normalizeLinkInput(candidate);
  if (!url) return { ok: false, reason: "Похоже, это не адрес страницы. Пример: instagram.com/имя" };
  if (links.some((link) => sameUrl(link.url, url))) return { ok: false, reason: "Эта ссылка уже есть в списке" };
  const added: EditableLink = { key: freshKey(), url, label: null, linkStatus: null };
  return { ok: true, links: [...links, added], added };
}

export function removeLink(links: readonly EditableLink[], key: string): EditableLink[] {
  if (links.length <= 1) return [...links];
  return links.filter((link) => link.key !== key);
}

export function canRemove(links: readonly EditableLink[]): boolean {
  return links.length > 1;
}

export function moveLink(links: readonly EditableLink[], from: number, to: number): EditableLink[] {
  if (from === to || from < 0 || to < 0 || from >= links.length || to >= links.length) return [...links];
  const next = [...links];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function setLabel(links: readonly EditableLink[], key: string, text: string): EditableLink[] {
  const label = text.trim() ? text : null;
  return links.map((link) => (link.key === key ? { ...link, label } : link));
}

export function autoLabel(url: string): string {
  return displayLabel(url, null);
}

export function linkPlatform(url: string): string | null {
  return platformForUrl(url)?.key ?? null;
}

export function linksChanged(before: readonly EditableLink[], after: readonly EditableLink[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((link, i) => link.url !== after[i].url || (link.label ?? "") !== (after[i].label ?? ""));
}
