import { splitHighlighted } from "../lib/highlight";

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
