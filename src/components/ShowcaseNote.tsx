import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

interface ShowcaseNoteAction {
  label: string;
  icon: IconName;
  onClick: () => void;
}

interface ShowcaseNoteProps {
  icon: IconName;
  action?: ShowcaseNoteAction;
  className?: string;
  children: ReactNode;
}

export function ShowcaseNote({ icon, action, className, children }: ShowcaseNoteProps) {
  const classes = ["showcase-note", action ? "" : "showcase-note-plain", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <span className="showcase-note-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <p className="showcase-note-text">{children}</p>
      {action ? (
        <button type="button" className="showcase-note-action" onClick={action.onClick}>
          {action.label}
          <span className="showcase-note-mark" aria-hidden="true">
            <Icon name={action.icon} />
          </span>
        </button>
      ) : null}
    </div>
  );
}
