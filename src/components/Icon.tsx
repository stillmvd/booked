import type { ReactNode } from "react";

export type IconName = "search" | "close" | "chevron-down" | "chevron-up" | "chevron-right" | "blocked";

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
