import { tint } from "../lib/plate";
import type { ResolvedTheme } from "../lib/theme";

interface TagDotsProps {
  tags: string[];
  theme: ResolvedTheme;
  matched?: Set<string> | null;
  className?: string;
}

const MAX_DOTS = 5;

export function TagDots({ tags, theme, matched, className }: TagDotsProps) {
  const visible = tags.slice(0, MAX_DOTS);
  const label = visible.join(", ");
  return (
    <span
      className={className ? `tag-dots ${className}` : "tag-dots"}
      title={visible.length > 0 ? label : undefined}
      role={visible.length > 0 ? "img" : undefined}
      aria-label={visible.length > 0 ? `Теги: ${label}` : undefined}
    >
      {visible.map((tag) => (
        <span
          key={tag}
          className="tag-dot"
          style={{ background: matched?.has(tag) ? "var(--accent)" : tint(tag, theme).fg }}
        />
      ))}
    </span>
  );
}
