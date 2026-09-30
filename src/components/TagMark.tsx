import type { ReactNode } from "react";

import { plateIndex } from "../lib/plate";

type TagMarkSize = "md" | "sm" | "xs";

interface TagMarkProps {
  name: string;
  size?: TagMarkSize;
  pinned?: boolean;
  matched?: boolean;
  children?: ReactNode;
}

export function TagMark({ name, size = "md", pinned, matched, children }: TagMarkProps) {
  const className =
    `tag-mark tag-mark-${size} tag-tone-${plateIndex(name)}` + (pinned ? " pinned" : "") + (matched ? " matched" : "");
  return (
    <span className={className}>
      <span className="tag-mark-body">
        {size === "xs" ? null : <span className="tag-mark-name">{name}</span>}
        {children}
      </span>
      {pinned ? <span className="tag-mark-pin" aria-hidden="true" /> : null}
    </span>
  );
}

interface TagMarksProps {
  tags: string[];
  size: "sm" | "xs";
  max: number;
  matched?: Set<string> | null;
  className?: string;
}

export function TagMarks({ tags, size, max, matched, className }: TagMarksProps) {
  if (tags.length === 0) return <span className={className ? `tag-marks ${className}` : "tag-marks"} />;
  const ordered = matched ? [...tags].sort((a, b) => Number(matched.has(b)) - Number(matched.has(a))) : tags;
  const shown = ordered.slice(0, max);
  const rest = tags.length - shown.length;
  const label = tags.join(", ");
  return (
    <span
      className={className ? `tag-marks ${className}` : "tag-marks"}
      role="img"
      aria-label={`Теги: ${label}`}
      title={label}
    >
      {shown.map((tag) => (
        <TagMark key={tag} name={tag} size={size} matched={matched?.has(tag)} />
      ))}
      {rest > 0 ? <span className="tag-marks-more">+{rest}</span> : null}
    </span>
  );
}
