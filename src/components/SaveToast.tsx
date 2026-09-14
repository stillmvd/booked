import { ToastUndo } from "./ToastParts";

interface SaveToastProps {
  text: string;
  onCancel: () => void;
}

export function SaveToast({ text, onCancel }: SaveToastProps) {
  return (
    <div className="toast toast-inline">
      <span className="toast-text">{text}</span>
      <ToastUndo onClick={onCancel} />
    </div>
  );
}
