import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  bookmarkCreate,
  bookmarkDelete,
  bookmarkFindDuplicate,
  bookmarkSetTags,
  bookmarkUpdate,
  folderListAll,
  imageImport,
  imagePath,
} from "../lib/api";
import type { Bookmark, DuplicateHit, FolderRef } from "../lib/types";
import { buildPaths } from "./FolderForm";
import { DuplicateBanner } from "./DuplicateBanner";
import { TagInput } from "./TagInput";

interface BookmarkFormProps {
  bookmark: Bookmark | null;
  folderId: number | null;
  onClose: () => void;
  onSaved: () => void;
  onNavigateToDuplicate: (hit: DuplicateHit) => void;
}

export function BookmarkForm({
  bookmark,
  folderId,
  onClose,
  onSaved,
  onNavigateToDuplicate,
}: BookmarkFormProps) {
  const isEdit = bookmark !== null;
  const [url, setUrl] = useState(bookmark?.url ?? "");
  const [title, setTitle] = useState(bookmark?.title ?? "");
  const [description, setDescription] = useState(bookmark?.description ?? "");
  const [showDescription, setShowDescription] = useState(Boolean(bookmark?.description));
  const [image, setImage] = useState<string | null>(bookmark?.image ?? null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(bookmark?.tags ?? []);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    isEdit ? bookmark.folderId : folderId,
  );
  const [refs, setRefs] = useState<FolderRef[]>([]);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    folderListAll().then(setRefs);
  }, []);

  useEffect(() => {
    if (!image) {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    imagePath(image).then((full) => {
      if (!cancelled) setImageSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [image]);

  useEffect(() => {
    if (!url.trim()) {
      setDuplicate(null);
      return;
    }
    let cancelled = false;
    bookmarkFindDuplicate(url.trim()).then((hit) => {
      if (!cancelled) setDuplicate(isEdit && hit?.id === bookmark.id ? null : hit);
    });
    return () => {
      cancelled = true;
    };
  }, [url, isEdit, bookmark]);

  const paths = buildPaths(refs);

  async function handlePickImage() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Изображение", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    const filename = await imageImport(picked);
    setImage(filename);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const trimmedUrl = url.trim();
      const trimmedTitle = title.trim();
      if (isEdit) {
        await bookmarkUpdate(
          bookmark.id,
          selectedFolderId,
          trimmedTitle,
          trimmedUrl,
          description || null,
          image,
        );
        await bookmarkSetTags(bookmark.id, tags);
      } else {
        const id = await bookmarkCreate(
          selectedFolderId,
          trimmedTitle,
          trimmedUrl,
          description || null,
          image,
        );
        try {
          await bookmarkSetTags(id, tags);
        } catch (err) {
          await bookmarkDelete(id).catch((cleanupErr) => console.error(cleanupErr));
          throw err;
        }
      }
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
      <h2>{isEdit ? "Свойства закладки" : "Новая закладка"}</h2>

      {duplicate ? (
        <DuplicateBanner
          hit={duplicate}
          onGoTo={() => {
            onNavigateToDuplicate(duplicate);
            onClose();
          }}
          onSaveAnyway={save}
        />
      ) : null}

      <label className="field">
        <span className="field-label">Адрес</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus={!isEdit}
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

      <div className="field">
        <span className="field-label">Картинка</span>
        {imageSrc ? <img className="folder-image-preview" src={imageSrc} alt="" /> : null}
        <button type="button" className="link-button" onClick={handlePickImage}>
          {image ? "Заменить картинку" : "+ Добавить картинку"}
        </button>
      </div>

      <label className="field">
        <span className="field-label">Теги</span>
        <TagInput tags={tags} onChange={setTags} />
      </label>

      <label className="field">
        <span className="field-label">Папка</span>
        <select
          value={selectedFolderId === null ? "" : String(selectedFolderId)}
          onChange={(e) =>
            setSelectedFolderId(e.target.value === "" ? null : Number(e.target.value))
          }
        >
          <option value="">Trove (корень)</option>
          {refs.map((ref) => (
            <option value={ref.id} key={ref.id}>
              {paths.get(ref.id)}
            </option>
          ))}
        </select>
      </label>

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
