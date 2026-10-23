import { withV } from "../lib/gameFormat";
import { Icon } from "./Icon";

interface DownloadProps {
  version: string | null;
  onOpen: () => void;
}

export function DownloadButton({ version, onOpen }: DownloadProps) {
  return (
    <button type="button" className="dl-btn" title="Откроется пост с загрузками на F95zone" onClick={onOpen}>
      Скачать
      {version ? <small>{withV(version)}</small> : null}
      <span className="dl-btn-chevron" aria-hidden="true">
        <Icon name="arrow-up-right" />
      </span>
    </button>
  );
}
