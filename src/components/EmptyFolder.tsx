import { splitTitle } from "../lib/platforms";
import { Icon } from "./Icon";

interface EmptyFolderProps {
  isRoot: boolean;
  onAddBookmark: () => void;
  onCreateFolder: () => void;
}

export function EmptyFolder({ isRoot, onAddBookmark, onCreateFolder }: EmptyFolderProps) {
  const title = splitTitle(isRoot ? "Здесь пока пусто" : "В этой папке пока ничего нет");
  return (
    <div className="empty-folder">
      <div className="empty-folder-art" aria-hidden="true">
        <span className="empty-folder-back" />
        <span className="empty-folder-body">
          <Icon name="bookmark" />
        </span>
      </div>
      <h2 className="empty-folder-title">
        {title.light ? <span className="empty-folder-title-light">{title.light} </span> : null}
        {title.bold}
      </h2>
      <div className="empty-folder-actions">
        <button type="button" className="empty-folder-primary" onClick={onAddBookmark}>
          Добавить закладку
          <span className="btn-mark" aria-hidden="true">
            <Icon name="plus" />
          </span>
        </button>
        <button type="button" onClick={onCreateFolder}>
          Новая подпапка
        </button>
      </div>
    </div>
  );
}
