import { useId } from "react";

import type { GameStatus } from "../lib/types";

interface Palette {
  back: [string, string, string];
  glass: [string, string];
  dot: [string, string];
  shade: string;
}

const PALETTES: Record<GameStatus, Palette> = {
  new: { back: ["#dcd1ff", "#9d8cff", "#5a49d6"], glass: ["#e8e2ff", "#c4b8ff"], dot: ["#dcd1ff", "#9d8cff"], shade: "#3a2c9a" },
  playing: { back: ["#ffd09c", "#ff9f5a", "#e85d22"], glass: ["#ffe6d2", "#ffc29a"], dot: ["#ffd09c", "#ff9f5a"], shade: "#9a3f12" },
  finished: { back: ["#a6f2e7", "#4fc7b8", "#108a7a"], glass: ["#d6f7f1", "#9fe3d8"], dot: ["#a6f2e7", "#4fc7b8"], shade: "#0d5c52" },
  wish: { back: ["#ffb8ae", "#ff6b5e", "#d42f2f"], glass: ["#ffe0dc", "#ffaea6"], dot: ["#ffb8ae", "#ff6b5e"], shade: "#8a1a1a" },
  disliked: { back: ["#d9d9de", "#a2a2a9", "#5c5c63"], glass: ["#ececef", "#c8c8cd"], dot: ["#d9d9de", "#a2a2a9"], shade: "#2a2a2e" },
};

export const STATUS_GLOW: Record<GameStatus, string> = {
  new: PALETTES.new.back[1],
  playing: PALETTES.playing.back[1],
  finished: PALETTES.finished.back[1],
  wish: PALETTES.wish.back[1],
  disliked: PALETTES.disliked.back[1],
};

const LINES = { fill: "#fff", fillOpacity: 0.42 };
const STROKE = { fill: "none", stroke: "#fff", strokeLinecap: "round", strokeLinejoin: "round" } as const;

function back(status: GameStatus, gradient: string) {
  switch (status) {
    case "new":
      return (
        <>
          <rect x="34" y="8" width="54" height="66" rx="14" fill={gradient} />
          <rect x="44" y="20" width="34" height="5" rx="2.5" {...LINES} />
          <rect x="44" y="31" width="22" height="5" rx="2.5" {...LINES} />
          <circle cx="78" cy="62" r="4" fill="#fff" fillOpacity={0.75} />
        </>
      );
    case "playing":
      return (
        <>
          <path
            d="M44 10h34a20 20 0 0 1 19.6 16l4.4 24a11 11 0 0 1-19.4 9L76 52H46l-6.6 7a11 11 0 0 1-19.4-9l4.4-24A20 20 0 0 1 44 10z"
            fill={gradient}
          />
          <circle cx="80" cy="28" r="4" fill="#fff" fillOpacity={0.75} />
          <rect x="44" y="26" width="16" height="5" rx="2.5" {...LINES} />
          <rect x="49.5" y="20.5" width="5" height="16" rx="2.5" {...LINES} />
        </>
      );
    case "finished":
      return (
        <>
          <path d="M44 8h36v22a18 18 0 0 1-36 0z" fill={gradient} />
          <path d="M44 14H34a9 9 0 0 0 10 14M80 14h10a9 9 0 0 1-10 14" {...STROKE} stroke={gradient} strokeWidth={4} />
          <rect x="58" y="46" width="8" height="14" rx="3" fill={gradient} />
          <rect x="46" y="58" width="32" height="10" rx="5" fill={gradient} />
          <rect x="52" y="16" width="20" height="5" rx="2.5" {...LINES} />
        </>
      );
    case "wish":
      return (
        <>
          <path d="M46 6h36a8 8 0 0 1 8 8v64l-26-15-26 15V14a8 8 0 0 1 8-8z" fill={gradient} />
          <rect x="52" y="18" width="26" height="5" rx="2.5" {...LINES} />
          <rect x="52" y="29" width="16" height="5" rx="2.5" {...LINES} />
        </>
      );
    case "disliked":
      return (
        <>
          <rect x="32" y="10" width="58" height="62" rx="16" fill={gradient} />
          <rect x="44" y="22" width="34" height="5" rx="2.5" {...LINES} />
          <rect x="44" y="33" width="22" height="5" rx="2.5" {...LINES} />
        </>
      );
  }
}

function front(status: GameStatus) {
  if (status === "new") return <rect x="9" y="30" width="58" height="58" rx="20" />;
  return <circle cx={status === "wish" ? 36 : 38} cy="60" r="28" />;
}

function glyph(status: GameStatus) {
  switch (status) {
    case "new":
      return <path d="M31 47.5v21c0 2.3 2.5 3.7 4.5 2.5l17-10.5a2.9 2.9 0 0 0 0-5L35.5 45c-2-1.2-4.5.2-4.5 2.5z" fill="#fff" />;
    case "playing":
      return (
        <>
          <path d="M38 46a14 14 0 1 1-13.3 9.7" {...STROKE} strokeWidth={5} />
          <circle cx="38" cy="60" r="4.5" fill="#fff" />
        </>
      );
    case "finished":
      return <path d="M26.5 60.5l8 8 16-17" {...STROKE} strokeWidth={6} />;
    case "wish":
      return <path d="M36 74s-15-8.6-15-19.4a8 8 0 0 1 15-4 8 8 0 0 1 15 4C51 65.4 36 74 36 74z" fill="#fff" />;
    case "disliked":
      return (
        <g transform="translate(22 43) scale(2)">
          <path
            d="M5.5 9.5V3h6.6a1.4 1.4 0 0 1 1.38 1.15l.75 4a1.4 1.4 0 0 1-1.38 1.65H9.5l.6 2.6a1.3 1.3 0 0 1-2.4.95L5.5 9.5ZM5.5 3H2.75v6.5H5.5"
            fill="#fff"
            stroke="#fff"
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
        </g>
      );
  }
}

export function StatusGlyph({ status, className }: { status: GameStatus; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const p = PALETTES[status];
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const dot: [number, number] = status === "wish" ? [86, 86] : [86, 84];
  return (
    <svg className={className} viewBox="0 0 96 96" aria-hidden="true">
      <defs>
        <linearGradient id={id("gb")} x1="88" y1="6" x2="30" y2="78" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={p.back[0]} />
          <stop offset=".45" stopColor={p.back[1]} />
          <stop offset="1" stopColor={p.back[2]} />
        </linearGradient>
        <linearGradient id={id("gg")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.78} />
          <stop offset=".5" stopColor={p.glass[0]} stopOpacity={0.5} />
          <stop offset="1" stopColor={p.glass[1]} stopOpacity={0.42} />
        </linearGradient>
        <linearGradient id={id("gs")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={1} />
          <stop offset=".45" stopColor="#fff" stopOpacity={0.3} />
          <stop offset="1" stopColor="#fff" stopOpacity={0.1} />
        </linearGradient>
        <linearGradient id={id("gd")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.dot[0]} />
          <stop offset="1" stopColor={p.dot[1]} />
        </linearGradient>
        <filter id={id("fb")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={id("fs")} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="b" />
          <feOffset in="b" dy="3" result="o" />
          <feFlood floodColor={p.shade} floodOpacity={0.3} />
          <feComposite in2="o" operator="in" result="s" />
          <feMerge>
            <feMergeNode in="s" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={id("fg")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="b" />
          <feOffset in="b" dy="2" result="o" />
          <feFlood floodColor={p.shade} floodOpacity={0.18} />
          <feComposite in2="o" operator="in" />
        </filter>
        <clipPath id={id("cf")}>{front(status)}</clipPath>
        <g id={id("back")}>{back(status, url("gb"))}</g>
      </defs>
      <use href={`#${id("back")}`} filter={url("fs")} />
      <g filter={url("fg")}>{front(status)}</g>
      <g clipPath={url("cf")}>
        <use href={`#${id("back")}`} filter={url("fb")} />
        <rect width="96" height="96" fill={url("gg")} />
      </g>
      <g fill="none" stroke={url("gs")} strokeWidth={1.4}>
        {front(status)}
      </g>
      {glyph(status)}
      <circle cx={dot[0]} cy={dot[1]} r="5" fill={url("gd")} />
    </svg>
  );
}
