interface EmptyFolderProps {
  isRoot: boolean;
  onAddBookmark: () => void;
  onCreateFolder: () => void;
}

export function EmptyFolder({ isRoot, onAddBookmark, onCreateFolder }: EmptyFolderProps) {
  return (
    <div className="empty-folder">
      <p>{isRoot ? "Здесь пока пусто" : "В этой папке пока ничего нет"}</p>
      <div className="empty-folder-actions">
        <button type="button" onClick={onAddBookmark}>
          Добавить закладку
        </button>
        <button type="button" onClick={onCreateFolder}>
          Новая подпапка
        </button>
      </div>
    </div>
  );
}
