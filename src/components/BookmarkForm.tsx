import { useState } from "react";
import type { FormEvent } from "react";

import { bookmarkCreate } from "../lib/api";

interface BookmarkFormProps {
  folderId: number | null;
  onClose: () => void;
  onSaved: () => void;
}

export function BookmarkForm({ folderId, onClose, onSaved }: BookmarkFormProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await bookmarkCreate(folderId, title.trim(), url.trim(), description || null, null);
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    await save();
  }

  return (
    <form className="bookmark-form" onSubmit={handleSubmit}>
      <h2>Новая закладка</h2>

      <label className="field">
        <span className="field-label">Адрес</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
          placeholder="example.com/страница"
        />
        {error ? <p className="form-error">{error}</p> : null}
      </label>

      <label className="field">
        <span className="field-label">Название</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {showDescription ? (
        <label className="field">
          <span className="field-label">Описание</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            autoFocus
          />
        </label>
      ) : (
        <button type="button" className="link-button" onClick={() => setShowDescription(true)}>
          + Добавить описание
        </button>
      )}

      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" disabled={!url.trim() || saving}>
          Сохранить
        </button>
      </div>
    </form>
  );
}
