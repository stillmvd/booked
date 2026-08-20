import { useEffect, useState } from "react";

import { DELETE_DELAY_MS } from "../lib/pendingDeletions";

interface DeleteToastProps {
  label: string;
  onCancel: () => void;
}

export function DeleteToast({ label, onCancel }: DeleteToastProps) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(DELETE_DELAY_MS / 1000));

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  return (
    <div className="delete-toast">
      <span className="delete-toast-label">Удаляется «{label}»</span>
      <span className="delete-toast-seconds">{Math.max(secondsLeft, 0)}</span>
      <button type="button" className="delete-toast-cancel" onClick={onCancel}>
        Отменить
      </button>
    </div>
  );
}
