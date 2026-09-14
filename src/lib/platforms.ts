import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN } from "./highlight.ts";
import { pluralizeRu } from "./pluralizeRu.ts";

export const PLATFORM_DOMAINS: ReadonlyArray<readonly [domain: string, key: string, name: string]> = [
  ["instagram.com", "instagram", "Instagram"],
  ["instagr.am", "instagram", "Instagram"],
  ["tiktok.com", "tiktok", "TikTok"],
  ["t.me", "telegram", "Telegram"],
  ["telegram.me", "telegram", "Telegram"],
  ["telegram.org", "telegram", "Telegram"],
  ["youtube.com", "youtube", "YouTube"],
  ["youtu.be", "youtube", "YouTube"],
  ["x.com", "x", "X"],
  ["twitter.com", "x", "X"],
  ["vk.com", "vk", "VK"],
  ["vk.ru", "vk", "VK"],
  ["twitch.tv", "twitch", "Twitch"],
  ["kick.com", "kick", "Kick"],
  ["boosty.to", "boosty", "Boosty"],
  ["patreon.com", "patreon", "Patreon"],
  ["pinterest.com", "pinterest", "Pinterest"],
  ["pinterest.ru", "pinterest", "Pinterest"],
  ["pin.it", "pinterest", "Pinterest"],
  ["facebook.com", "facebook", "Facebook"],
  ["fb.com", "facebook", "Facebook"],
  ["threads.net", "threads", "Threads"],
  ["threads.com", "threads", "Threads"],
  ["bsky.app", "bluesky", "Bluesky"],
  ["reddit.com", "reddit", "Reddit"],
  ["tumblr.com", "tumblr", "Tumblr"],
  ["discord.gg", "discord", "Discord"],
  ["discord.com", "discord", "Discord"],
  ["github.com", "github", "GitHub"],
  ["behance.net", "behance", "Behance"],
  ["artstation.com", "artstation", "ArtStation"],
  ["deviantart.com", "deviantart", "DeviantArt"],
  ["onlyfans.com", "onlyfans", "OnlyFans"],
  ["fansly.com", "fansly", "Fansly"],
  ["linktr.ee", "linktree", "Linktree"],
  ["dzen.ru", "dzen", "Дзен"],
  ["rutube.ru", "rutube", "Rutube"],
];

export interface Platform {
  key: string;
  name: string;
}

function bareHost(host: string): string {
  const lower = host.replace(/\.+$/, "").toLowerCase();
  for (const prefix of ["www.", "m.", "mobile."]) {
    if (lower.startsWith(prefix) && lower.slice(prefix.length).includes(".")) return lower.slice(prefix.length);
  }
  return lower;
}

function hostOfUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host ? bareHost(host) : null;
  } catch {
    return null;
  }
}

export function platformForUrl(url: string): Platform | null {
  const host = hostOfUrl(url);
  if (!host) return null;
  const hit = PLATFORM_DOMAINS.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  return hit ? { key: hit[1], name: hit[2] } : null;
}

export function displayLabel(url: string, label: string | null): string {
  const custom = label?.trim();
  if (custom) return custom;
  const host = hostOfUrl(url);
  if (!host) return url;
  return platformForUrl(url)?.name ?? host;
}

export function linkCountLabel(n: number): string {
  return `${n} ${pluralizeRu(n, ["ссылка", "ссылки", "ссылок"])}`;
}

export function isMultiLink(bookmark: { links: readonly unknown[] }): boolean {
  return bookmark.links.length >= 2;
}

export interface TitleParts {
  light: string;
  bold: string;
}

export function splitTitle(text: string): TitleParts {
  let inside = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === HIGHLIGHT_OPEN) inside = true;
    else if (ch === HIGHLIGHT_CLOSE) inside = false;
    else if (ch === " " && i > 0) {
      const light = text.slice(0, i);
      const rest = text.slice(i + 1);
      if (!rest.trim()) break;
      return inside
        ? { light: light + HIGHLIGHT_CLOSE, bold: HIGHLIGHT_OPEN + rest }
        : { light, bold: rest };
    }
  }
  return { light: "", bold: text };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function linkHint(url: string, platform: string | null, customLabel: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = bareHost(parsed.hostname);
  const rawPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
  const path = safeDecode(rawPath) + safeDecode(parsed.search);
  if (platform) {
    if (!path) return host;
    if (!rawPath.includes("/") && !parsed.search && !path.startsWith("@")) return `@${path}`;
    return path;
  }
  if (customLabel) return path ? `${host}/${path}` : host;
  return path ? `/${path}` : "";
}
