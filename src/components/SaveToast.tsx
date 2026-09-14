interface SaveToastProps {
  text: string;
  onCancel: () => void;
}

export function SaveToast({ text, onCancel }: SaveToastProps) {
  return (
    <div className="save-toast">
      <span className="save-toast-label">{text}</span>
      <button type="button" className="save-toast-cancel" onClick={onCancel}>
        Отменить
      </button>
    </div>
  );
}
