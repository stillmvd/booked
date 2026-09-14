import { createElement } from "react";
import type { IconNode } from "morphicons";
import {
  siArtstation,
  siBehance,
  siBluesky,
  siBoosty,
  siDeviantart,
  siDiscord,
  siFacebook,
  siGithub,
  siInstagram,
  siKick,
  siLinktree,
  siOnlyfans,
  siPatreon,
  siPinterest,
  siReddit,
  siTelegram,
  siThreads,
  siTiktok,
  siTumblr,
  siTwitch,
  siVk,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";

export type IconName =
  | "search"
  | "close"
  | "chevron-down"
  | "chevron-up"
  | "chevron-right"
  | "blocked"
  | "sidebar"
  | "plus"
  | "folder-plus"
  | "clipboard"
  | "view-tiles"
  | "view-list"
  | "view-compact"
  | "reset"
  | "bookmark"
  | "image-plus"
  | "crop"
  | "play"
  | "gamepad"
  | "link"
  | "arrow-up-right"
  | "globe"
  | "grip"
  | "move"
  | "check";

export const ICONS: Record<IconName, IconNode> = {
  search: [
    ["circle", { cx: 7, cy: 7, r: 4.25 }],
    ["path", { d: "M10.5 10.5 14 14" }],
  ],
  close: [["path", { d: "M4 4l8 8M12 4l-8 8" }]],
  "chevron-down": [["path", { d: "M4 6.5 8 10.5 12 6.5" }]],
  "chevron-up": [["path", { d: "M4 9.5 8 5.5 12 9.5" }]],
  "chevron-right": [["path", { d: "M6.5 4 10.5 8 6.5 12" }]],
  blocked: [
    ["circle", { cx: 8, cy: 8, r: 5.25 }],
    ["path", { d: "M4.3 11.7 11.7 4.3" }],
  ],
  sidebar: [
    ["rect", { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }],
    ["path", { d: "M6.25 3v10" }],
  ],
  plus: [["path", { d: "M8 3.5v9M3.5 8h9" }]],
  "folder-plus": [
    [
      "path",
      {
        d: "M2 4.75A1.25 1.25 0 0 1 3.25 3.5h2.9l1.2 1.5h5.4A1.25 1.25 0 0 1 14 6.25v5.5a1.25 1.25 0 0 1-1.25 1.25h-9.5A1.25 1.25 0 0 1 2 11.75z",
      },
    ],
    ["path", { d: "M8 7.25v3.5M6.25 9h3.5" }],
  ],
  clipboard: [
    ["rect", { x: 3.5, y: 3, width: 9, height: 10.5, rx: 1.25 }],
    ["path", { d: "M6.25 3V2.25h3.5V3M6 7.5h4M6 10h2.75" }],
  ],
  "view-tiles": [
    ["rect", { x: 2.5, y: 2.5, width: 4.5, height: 4.5, rx: 1 }],
    ["rect", { x: 9, y: 2.5, width: 4.5, height: 4.5, rx: 1 }],
    ["rect", { x: 2.5, y: 9, width: 4.5, height: 4.5, rx: 1 }],
    ["rect", { x: 9, y: 9, width: 4.5, height: 4.5, rx: 1 }],
  ],
  "view-list": [
    ["rect", { x: 2.5, y: 3, width: 4, height: 3, rx: 0.75 }],
    ["path", { d: "M8.5 4.5H14" }],
    ["rect", { x: 2.5, y: 10, width: 4, height: 3, rx: 0.75 }],
    ["path", { d: "M8.5 11.5H14" }],
  ],
  "view-compact": [["path", { d: "M2.5 4h11M2.5 8h11M2.5 12h11" }]],
  reset: [
    ["path", { d: "M3.5 8a4.5 4.5 0 1 0 1.3-3.2" }],
    ["path", { d: "M3.5 3.25V6h2.75" }],
  ],
  bookmark: [["path", { d: "M4 2.5h8v11l-4-3-4 3z" }]],
  "image-plus": [
    ["path", { d: "M8.5 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13h9a1.5 1.5 0 0 0 1.5-1.5V8.5" }],
    ["path", { d: "M2 11l3-3 2.5 2.5 2-2L14 12" }],
    ["circle", { cx: 6, cy: 6.5, r: 1 }],
    ["path", { d: "M12.5 2v4M10.5 4h4" }],
  ],
  crop: [
    ["path", { d: "M5 1v10h10" }],
    ["path", { d: "M1 5h10v10" }],
  ],
  play: [["path", { d: "M5.5 3.5 13 8 5.5 12.5Z", fill: "currentColor" }]],
  gamepad: [
    [
      "path",
      {
        d: "M5.6 4.5h4.8a3.4 3.4 0 0 1 3.3 2.6l.8 3.4a1.7 1.7 0 0 1-3 1.4L10.3 10H5.7l-1.2 1.9a1.7 1.7 0 0 1-3-1.4l.8-3.4A3.4 3.4 0 0 1 5.6 4.5Z",
      },
    ],
    ["path", { d: "M4.6 6.6v2M3.6 7.6h2" }],
    ["circle", { cx: 11, cy: 7.4, r: 0.85 }],
  ],
  link: [
    ["path", { d: "M6.67 9.33a2.67 2.67 0 0 0 3.8 0l2-2a2.67 2.67 0 0 0-3.8-3.8l-.67.67" }],
    ["path", { d: "M9.33 6.67a2.67 2.67 0 0 0-3.8 0l-2 2a2.67 2.67 0 0 0 3.8 3.8l.67-.67" }],
  ],
  "arrow-up-right": [["path", { d: "M4.67 11.33 11.33 4.67M6 4.67h5.33V10" }]],
  globe: [
    ["circle", { cx: 8, cy: 8, r: 5.67 }],
    ["path", { d: "M2.33 8h11.34" }],
    ["path", { d: "M8 2.33c1.53 1.6 2.33 3.47 2.33 5.67S9.53 12.07 8 13.67C6.47 12.07 5.67 10.2 5.67 8S6.47 3.93 8 2.33z" }],
  ],
  grip: [
    ["circle", { cx: 6, cy: 4, r: 0.95, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 6, cy: 8, r: 0.95, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 6, cy: 12, r: 0.95, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 10, cy: 4, r: 0.95, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 10, cy: 8, r: 0.95, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 10, cy: 12, r: 0.95, fill: "currentColor", stroke: "none" }],
  ],
  move: [
    ["path", { d: "M8 2.67v10.66M2.67 8h10.66" }],
    ["path", { d: "M6 4.33l2-2 2 2M6 11.67l2 2 2-2M4.33 6l-2 2 2 2M11.67 6l2 2-2 2" }],
  ],
  check: [["path", { d: "M3.67 8.33 6.33 11l6-6" }]],
};

const PLATFORM_ICONS: Record<string, SimpleIcon> = {
  instagram: siInstagram,
  tiktok: siTiktok,
  telegram: siTelegram,
  youtube: siYoutube,
  x: siX,
  vk: siVk,
  twitch: siTwitch,
  kick: siKick,
  boosty: siBoosty,
  patreon: siPatreon,
  pinterest: siPinterest,
  facebook: siFacebook,
  threads: siThreads,
  bluesky: siBluesky,
  reddit: siReddit,
  tumblr: siTumblr,
  discord: siDiscord,
  github: siGithub,
  behance: siBehance,
  artstation: siArtstation,
  deviantart: siDeviantart,
  onlyfans: siOnlyfans,
  linktree: siLinktree,
};

interface PlatformIconProps {
  platform: string | null;
  className?: string;
}

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const mark = platform ? PLATFORM_ICONS[platform] : undefined;
  if (!mark) return <Icon name="globe" className={className} />;
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={mark.path} />
    </svg>
  );
}

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
