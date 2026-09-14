import { DELETE_DELAY_MS } from "../lib/pendingDeletions";
import { ToastUndo } from "./ToastParts";

interface DeleteToastProps {
  label: string;
  group?: boolean;
  hiding?: boolean;
  onCancel: () => void;
}

export function DeleteToast({ label, group = false, hiding = false, onCancel }: DeleteToastProps) {
  return (
    <div className={"toast" + (hiding ? " hiding" : "")}>
      <span className="toast-timer-track" aria-hidden="true">
        <span className="toast-timer" style={{ animationDuration: `${DELETE_DELAY_MS}ms` }} />
      </span>
      <span className="toast-text">{group ? `Удаление: ${label}` : `Удаляется «${label}»`}</span>
      <ToastUndo onClick={onCancel} disabled={hiding} />
    </div>
  );
}
