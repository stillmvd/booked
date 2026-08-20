interface EmptyFolderProps {
  isRoot: boolean;
  onAddBookmark: () => void;
  onCreateFolder: () => void;
  onDeleteFolder: () => void;
}

export function EmptyFolder({ isRoot, onAddBookmark, onCreateFolder, onDeleteFolder }: EmptyFolderProps) {
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
        {!isRoot && (
          <button type="button" className="danger-button" onClick={onDeleteFolder}>
            Удалить эту папку
          </button>
        )}
      </div>
    </div>
  );
}
