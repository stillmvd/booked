import type { DuplicateHit } from "../lib/types";

interface DuplicateBannerProps {
  hit: DuplicateHit;
  linkLabel?: string;
  onGoTo: () => void;
  onSaveAnyway: () => void;
}

export function DuplicateBanner({ hit, linkLabel, onGoTo, onSaveAnyway }: DuplicateBannerProps) {
  const folderLabel = hit.folderName ?? "Booked";
  const where = hit.primary ? "" : " среди ссылок";

  return (
    <div className="duplicate-banner">
      <span>
        {linkLabel
          ? `Ссылка «${linkLabel}» уже есть${where} у закладки «${hit.title}» в «${folderLabel}»`
          : `Уже сохранено в «${folderLabel}»`}
      </span>
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
