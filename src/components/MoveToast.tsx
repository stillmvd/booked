import { ToastUndo } from "./ToastParts";

export type MoveToastVariant = "moved" | "sorted";

interface MoveToastProps {
  variant: MoveToastVariant;
  folderName?: string;
  hiding?: boolean;
  onCancel: () => void;
}

export function MoveToast({ variant, folderName, hiding = false, onCancel }: MoveToastProps) {
  const text =
    variant === "moved"
      ? `Перенесено в «${folderName ?? "Booked"}»`
      : "Сортировка снята, порядок теперь ручной";

  return (
    <div className={"toast" + (hiding ? " hiding" : "")} role="status" aria-live="polite">
      <span className="toast-text">{text}</span>
      <ToastUndo onClick={onCancel} />
    </div>
  );
}
