import type { ReactNode } from "react";

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
  | "clipboard";

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  "chevron-down": <path d="M4 6.5 8 10.5 12 6.5" />,
  "chevron-up": <path d="M4 9.5 8 5.5 12 9.5" />,
  "chevron-right": <path d="M6.5 4 10.5 8 6.5 12" />,
  blocked: (
    <>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M4.3 11.7 11.7 4.3" />
    </>
  ),
  sidebar: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6.25 3v10" />
    </>
  ),
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  "folder-plus": (
    <>
      <path d="M2 4.75A1.25 1.25 0 0 1 3.25 3.5h2.9l1.2 1.5h5.4A1.25 1.25 0 0 1 14 6.25v5.5a1.25 1.25 0 0 1-1.25 1.25h-9.5A1.25 1.25 0 0 1 2 11.75z" />
      <path d="M8 7.25v3.5M6.25 9h3.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="3.5" y="3" width="9" height="10.5" rx="1.25" />
      <path d="M6.25 3V2.25h3.5V3M6 7.5h4M6 10h2.75" />
    </>
  ),
};

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
      {PATHS[name]}
    </svg>
  );
}
