import { splitHighlighted } from "../lib/highlight";
import { splitTitle } from "../lib/platforms";

interface HighlightedProps {
  text: string;
}

export function Highlighted({ text }: HighlightedProps) {
  const segments = splitHighlighted(text);
  return (
    <>
      {segments.map((segment, i) =>
        segment.highlighted ? <mark key={i}>{segment.text}</mark> : segment.text,
      )}
    </>
  );
}

interface SplitNameProps {
  text: string;
  className?: string;
}

export function SplitName({ text, className }: SplitNameProps) {
  const name = splitTitle(text);
  return (
    <span className={className ? `multi-name ${className}` : "multi-name"}>
      {name.light && (
        <span className="multi-name-light">
          <Highlighted text={name.light} />{" "}
        </span>
      )}
      <span className="multi-name-bold">
        <Highlighted text={name.bold} />
      </span>
    </span>
  );
}
