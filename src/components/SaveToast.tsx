interface SaveToastProps {
  folderLabel: string;
  onCancel: () => void;
}

export function SaveToast({ folderLabel, onCancel }: SaveToastProps) {
  return (
    <div className="save-toast">
      <span className="save-toast-label">Сохранено в {folderLabel}</span>
      <button type="button" className="save-toast-cancel" onClick={onCancel}>
        Отменить
      </button>
    </div>
  );
}
