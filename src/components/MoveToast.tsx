import { useEffect, useState } from "react";

export type MoveToastVariant = "moved" | "sorted";

interface MoveToastProps {
  variant: MoveToastVariant;
  folderName?: string;
  hiding?: boolean;
  onCancel: () => void;
}

export function MoveToast({ variant, folderName, hiding = false, onCancel }: MoveToastProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const text =
    variant === "moved"
      ? `Перенесено в «${folderName ?? "Trove"}»`
      : "Сортировка снята, порядок теперь ручной";

  return (
    <div
      className={"action-toast" + (open ? " open" : "") + (hiding ? " hiding" : "")}
      role="status"
      aria-live="polite"
    >
      <span className="save-toast-label">{text}</span>
      <button type="button" className="save-toast-cancel" onClick={onCancel}>
        Отменить
      </button>
    </div>
  );
}
