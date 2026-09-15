import { splitTitle } from "../lib/platforms";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

interface GamesEmptyAction {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onClick: () => void;
}

interface GamesEmptyProps {
  icon: IconName;
  title: string;
  text: string;
  action?: GamesEmptyAction;
}

export function GamesEmpty({ icon, title, text, action }: GamesEmptyProps) {
  const parts = splitTitle(title);
  return (
    <div className="empty-folder games-empty">
      <div className="empty-folder-art" aria-hidden="true">
        <span className="empty-folder-back" />
        <span className="empty-folder-body">
          <Icon name={icon} />
        </span>
      </div>
      <h2 className="empty-folder-title">
        {parts.light ? <span className="empty-folder-title-light">{parts.light} </span> : null}
        {parts.bold}
      </h2>
      <p className="games-empty-text">{text}</p>
      {action ? (
        <div className="empty-folder-actions">
          <button
            type="button"
            className={action.icon ? "empty-folder-primary" : undefined}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
            {action.icon ? (
              <span className="btn-mark" aria-hidden="true">
                <Icon name={action.icon} />
              </span>
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}
