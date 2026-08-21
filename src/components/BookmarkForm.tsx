import { useEffect, useRef, useState } from "react";
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

export interface BookmarkFormData {
  folderId: number | null;
  title: string;
  url: string;
  description: string | null;
  image: string | null;
  tags: string[];
}

interface BookmarkFormProps {
  bookmark: Bookmark | null;
  folderId: number | null;
  onClose: () => void;
  onSaved: (createdId?: number) => void;
  onNavigateToDuplicate: (hit: DuplicateHit) => void;
  compact?: boolean;
  initialUrl?: string;
  urlHint?: string | null;
  autoFocusField?: "url" | "title";
  onDirtyChange?: (dirty: boolean) => void;
  deferSubmit?: (data: BookmarkFormData) => void;
  externalError?: string | null;
}

export function BookmarkForm({
  bookmark,
  folderId,
  onClose,
  onSaved,
  onNavigateToDuplicate,
  compact = false,
  initialUrl,
  urlHint,
  autoFocusField,
  onDirtyChange,
  deferSubmit,
  externalError,
}: BookmarkFormProps) {
  const isEdit = bookmark !== null;
  const [url, setUrl] = useState(bookmark?.url ?? initialUrl ?? "");
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
  const [moreFieldsOpen, setMoreFieldsOpen] = useState(false);

  const snapshot = useRef({
    url,
    title,
    description,
    image,
    tags: tags.join(","),
    selectedFolderId,
  });

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

  useEffect(() => {
    if (!onDirtyChange) return;
    const snap = snapshot.current;
    const dirty =
      url !== snap.url ||
      title !== snap.title ||
      description !== snap.description ||
      image !== snap.image ||
      tags.join(",") !== snap.tags ||
      selectedFolderId !== snap.selectedFolderId;
    onDirtyChange(dirty);
  }, [url, title, description, image, tags, selectedFolderId, onDirtyChange]);

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
    const trimmedUrl = url.trim();
    const trimmedTitle = title.trim();

    if (deferSubmit) {
      deferSubmit({
        folderId: selectedFolderId,
        title: trimmedTitle,
        url: trimmedUrl,
        description: description || null,
        image,
        tags,
      });
      setSaving(false);
      return;
    }

    try {
      let createdId: number | undefined;
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
        createdId = id;
      }
      onSaved(createdId);
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

  const descriptionField = showDescription ? (
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
  );

  const imageField = (
    <div className="field">
      <span className="field-label">Картинка</span>
      {imageSrc ? <img className="folder-image-preview" src={imageSrc} alt="" /> : null}
      <button type="button" className="link-button" onClick={handlePickImage}>
        {image ? "Заменить картинку" : "+ Добавить картинку"}
      </button>
    </div>
  );

  const tagsField = (
    <label className="field">
      <span className="field-label">Теги</span>
      <TagInput tags={tags} onChange={setTags} />
    </label>
  );

  const folderField = (
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
  );

  const shownError = error || externalError;
  const resolvedAutoFocusField = autoFocusField ?? (isEdit ? undefined : "url");

  return (
    <form
      className={compact ? "bookmark-form bookmark-form-compact" : "bookmark-form"}
      onSubmit={handleSubmit}
    >
      {!compact ? <h2>{isEdit ? "Свойства закладки" : "Новая закладка"}</h2> : null}

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
          autoFocus={resolvedAutoFocusField === "url"}
          placeholder="example.com/страница"
        />
        {shownError ? (
          <p className="form-error">{shownError}</p>
        ) : urlHint ? (
          <p className="field-hint">{urlHint}</p>
        ) : null}
      </label>

      <label className="field">
        <span className="field-label">Название</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={resolvedAutoFocusField === "title"}
        />
      </label>

      {compact ? (
        <>
          {folderField}
          <button
            type="button"
            className="link-button"
            onClick={() => setMoreFieldsOpen((v) => !v)}
          >
            {moreFieldsOpen ? "Меньше полей" : "Больше полей"}
          </button>
          {moreFieldsOpen ? (
            <>
              {descriptionField}
              {imageField}
              {tagsField}
            </>
          ) : null}
        </>
      ) : (
        <>
          {descriptionField}
          {imageField}
          {tagsField}
          {folderField}
        </>
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
