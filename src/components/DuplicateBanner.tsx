import type { DuplicateHit } from "../lib/types";

interface DuplicateBannerProps {
  hit: DuplicateHit;
  onGoTo: () => void;
  onSaveAnyway: () => void;
}

export function DuplicateBanner({ hit, onGoTo, onSaveAnyway }: DuplicateBannerProps) {
  const folderLabel = hit.folderName ?? "Trove";

  return (
    <div className="duplicate-banner">
      <span>Уже сохранено в «{folderLabel}»</span>
      <div className="duplicate-banner-actions">
        <button type="button" className="link-button" onClick={onGoTo}>
          Перейти
        </button>
        <button type="button" className="link-button" onClick={onSaveAnyway}>
          Всё равно сохранить
        </button>
      </div>
    </div>
  );
}
