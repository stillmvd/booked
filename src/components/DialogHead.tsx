import type { ReactNode } from "react";

import { splitTitle } from "../lib/platforms";
import { Icon, type IconName } from "./Icon";

interface DialogHeadProps {
  id?: string;
  title: string;
  onClose: () => void;
  closeLabel?: string;
}

export function DialogHead({ id, title, onClose, closeLabel = "Закрыть" }: DialogHeadProps) {
  const parts = splitTitle(title);
  return (
    <div className="dialog-head">
      <h2 id={id} className="dialog-title">
        {parts.light ? <span className="dialog-title-light">{parts.light} </span> : null}
        {parts.bold}
      </h2>
      <button type="button" className="dialog-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}

interface DialogPocketProps {
  className?: string;
  children: ReactNode;
}

export function DialogPocket({ className, children }: DialogPocketProps) {
  return <div className={className ? `dialog-pocket ${className}` : "dialog-pocket"}>{children}</div>;
}

export function DialogFact({ icon, danger = false, children }: { icon: IconName; danger?: boolean; children: ReactNode }) {
  return (
    <p className={danger ? "dialog-fact dialog-fact-danger" : "dialog-fact"}>
      <span className="dialog-fact-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="dialog-fact-text">{children}</span>
    </p>
  );
}

export function SubmitMark() {
  return (
    <span className="btn-mark" aria-hidden="true">
      <Icon name="check" />
    </span>
  );
}
