import { Icon, type IconName } from "./Icon";

interface ToastUndoProps {
  disabled?: boolean;
  onClick: () => void;
}

export function ToastUndo({ disabled, onClick }: ToastUndoProps) {
  return (
    <button type="button" className="toast-undo" onClick={onClick} disabled={disabled}>
      Отменить
      <span className="toast-undo-circle" aria-hidden="true">
        <Icon name="undo" />
      </span>
    </button>
  );
}

interface ToastActionProps {
  label: string;
  icon: IconName;
  onClick: () => void;
}

export function ToastAction({ label, icon, onClick }: ToastActionProps) {
  return (
    <button type="button" className="toast-action" onClick={onClick}>
      {label}
      <span className="toast-action-circle" aria-hidden="true">
        <Icon name={icon} />
      </span>
    </button>
  );
}

export function ToastIcon({ name }: { name: IconName }) {
  return (
    <span className="toast-icon" aria-hidden="true">
      <Icon name={name} />
    </span>
  );
}
