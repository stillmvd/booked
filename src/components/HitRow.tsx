import { Icon } from "./Icon";
import type { IconName } from "./Icon";

interface HitRowProps {
  icon: IconName;
  title: string;
  note: string;
  onOpen: () => void;
}

export function HitRow({ icon, title, note, onOpen }: HitRowProps) {
  return (
    <button type="button" className="hit-row" onClick={onOpen}>
      <Icon name={icon} className="hit-row-icon" />
      <span className="hit-row-title">{title}</span>
      {note ? <span className="hit-row-note">{note}</span> : null}
    </button>
  );
}
