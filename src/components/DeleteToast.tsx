import { useEffect, useState } from "react";

import { DELETE_DELAY_MS } from "../lib/pendingDeletions";

interface DeleteToastProps {
  label: string;
  group?: boolean;
  hiding?: boolean;
  onCancel: () => void;
}

export function DeleteToast({ label, group = false, hiding = false, onCancel }: DeleteToastProps) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(DELETE_DELAY_MS / 1000));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  return (
    <div className={"delete-toast" + (open ? " open" : "") + (hiding ? " hiding" : "")}>
      <span className="delete-toast-label">{group ? `Удаление: ${label}` : `Удаляется «${label}»`}</span>
      <span className="delete-toast-seconds">{Math.max(secondsLeft, 0)}</span>
      <button type="button" className="delete-toast-cancel" onClick={onCancel} disabled={hiding}>
        Отменить
      </button>
    </div>
  );
}
