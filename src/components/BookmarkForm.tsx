import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  bookmarkCreate,
  bookmarkDelete,
  bookmarkFindDuplicate,
  bookmarkSetBrowser,
  bookmarkSetTags,
  bookmarkUpdate,
  browserDefaultGet,
  folderListAll,
  imageImport,
  mediaPath,
  metaFetch,
  previewClearUserImage,
  previewRefresh,
} from "../lib/api";
import type { Bookmark, BrowserTarget, DuplicateHit, FolderRef, LivenessItem, PreviewOrigin } from "../lib/types";
import { applyFetched, fallbackTitle, isDirty, markDirty } from "../lib/dirtyFields";
import type { DirtySet, FieldValues } from "../lib/dirtyFields";
import { mediaSrcOf } from "../lib/media";
import { userMessage } from "../lib/userMessage";
import { buildPaths } from "./FolderForm";
import { BrowserPicker } from "./BrowserPicker";
import { DuplicateBanner } from "./DuplicateBanner";
import { LivenessField } from "./LivenessField";
import { Select } from "./Select";
import { TagInput } from "./TagInput";

const META_DEBOUNCE_MS = 400;

function looksLikeHttpUrl(candidate: string): boolean {
  if (/\s/.test(candidate)) return false;
  for (const attempt of [candidate, `https://${candidate}`]) {
    try {
      const parsed = new URL(attempt);
      const httpish = parsed.protocol === "http:" || parsed.protocol === "https:";
      if (httpish && (parsed.hostname.includes(".") || parsed.hostname === "localhost")) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export interface BookmarkFormData {
  folderId: number | null;
  title: string;
  url: string;
  description: string | null;
  image: string | null;
  tags: string[];
  browser: string | null;
  profile: string | null;
  profileName: string | null;
}

interface BookmarkFormProps {
  bookmark: Bookmark | null;
  folderId: number | null;
  titleId?: string;
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
  onLivenessChecked?: (item: LivenessItem) => void;
}

export function BookmarkForm({
  bookmark,
  folderId,
  titleId,
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
  onLivenessChecked,
}: BookmarkFormProps) {
  const isEdit = bookmark !== null;
  const [url, setUrl] = useState(bookmark?.url ?? initialUrl ?? "");
  const [title, setTitle] = useState(bookmark?.title ?? "");
  const [description, setDescription] = useState(bookmark?.description ?? "");
  const [showDescription, setShowDescription] = useState(Boolean(bookmark?.description));
  const [image, setImage] = useState<string | null>(bookmark?.image ?? null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(bookmark?.previewFile ?? null);
  const [previewOrigin, setPreviewOrigin] = useState<PreviewOrigin | null>(
    bookmark?.previewOrigin ?? null,
  );
  const [refreshingImage, setRefreshingImage] = useState(false);
  const [tags, setTags] = useState<string[]>(bookmark?.tags ?? []);
  const [browserTarget, setBrowserTarget] = useState<BrowserTarget>({
    browser: bookmark?.targetBrowser ?? null,
    profile: bookmark?.targetProfile ?? null,
    profileName: bookmark?.targetProfileName ?? null,
  });
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    isEdit ? bookmark.folderId : folderId,
  );
  const [refs, setRefs] = useState<FolderRef[]>([]);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);
  const [moreFieldsOpen, setMoreFieldsOpen] = useState(
    Boolean(bookmark?.description || bookmark?.image || bookmark?.tags.length || bookmark?.targetBrowser),
  );
  const [titleAutoFilled, setTitleAutoFilled] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaFailed, setMetaFailed] = useState(false);

  const snapshot = useRef({
    url,
    title,
    description,
    image,
    tags: tags.join(","),
    selectedFolderId,
  });

  const dirtyRef = useRef<DirtySet>(
    isEdit ? new Set(["url", "title", "image"] as const) : new Set(),
  );
  const titleRef = useRef(title);
  titleRef.current = title;
  const urlRef = useRef(url);
  urlRef.current = url;
  const imageRef = useRef(image);
  imageRef.current = image;
  const metaFetchGenRef = useRef(0);

  useEffect(() => {
    folderListAll().then(setRefs);
  }, []);

  const browserTouchedRef = useRef(false);

  useEffect(() => {
    if (isEdit) return;
    browserDefaultGet().then((def) => {
      if (!browserTouchedRef.current) setBrowserTarget(def);
    });
  }, [isEdit]);

  function handleBrowserChange(target: BrowserTarget) {
    browserTouchedRef.current = true;
    setBrowserTarget(target);
  }

  useEffect(() => {
    const segments = mediaSrcOf({ image, previewFile, previewOrigin });
    if (!segments) {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    mediaPath(segments).then((full) => {
      if (!cancelled) setImageSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [image, previewFile, previewOrigin]);

  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setDuplicate(null);
      setMetaLoading(false);
      setMetaFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      bookmarkFindDuplicate(trimmed).then((hit) => {
        if (!cancelled) setDuplicate(isEdit && hit?.id === bookmark.id ? null : hit);
      });
      if (looksLikeHttpUrl(trimmed)) {
        runMetaFetch(trimmed);
      }
    }, META_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
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

  function applyAutoTitle(fetchedTitle: string) {
    const current: FieldValues = {
      url: urlRef.current,
      title: titleRef.current,
      image: imageRef.current,
    };
    const result = applyFetched(current, { title: fetchedTitle }, dirtyRef.current);
    if (result.title !== current.title) {
      setTitle(result.title);
      setTitleAutoFilled(true);
    }
  }

  function runMetaFetch(candidate: string) {
    const gen = ++metaFetchGenRef.current;
    setMetaLoading(true);
    setMetaFailed(false);
    metaFetch(candidate)
      .then((info) => {
        if (metaFetchGenRef.current !== gen) return;
        setMetaLoading(false);
        if (info.blocked) {
          setMetaFailed(true);
          applyAutoTitle(fallbackTitle(candidate));
          return;
        }
        const fetchedTitle = info.title?.trim() || fallbackTitle(candidate);
        applyAutoTitle(fetchedTitle);
      })
      .catch(() => {
        if (metaFetchGenRef.current !== gen) return;
        setMetaLoading(false);
        setMetaFailed(true);
        applyAutoTitle(fallbackTitle(candidate));
      });
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    dirtyRef.current = markDirty(dirtyRef.current, "title");
    setTitleAutoFilled(false);
  }

  function retryMetaFetch() {
    const trimmed = url.trim();
    if (trimmed) runMetaFetch(trimmed);
  }

  async function handlePickImage() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Изображение", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    const filename = await imageImport(picked);
    setImage(filename);
    dirtyRef.current = markDirty(dirtyRef.current, "image");
  }

  async function handleClearUserImage() {
    if (!isEdit) return;
    try {
      await previewClearUserImage(bookmark.id);
      setImage(null);
      dirtyRef.current = markDirty(dirtyRef.current, "image");
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRefreshImage() {
    if (!isEdit) return;
    setRefreshingImage(true);
    try {
      const info = await previewRefresh(bookmark.id);
      setPreviewFile(info.file);
      setPreviewOrigin(info.origin);
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshingImage(false);
    }
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
        browser: browserTarget.browser,
        profile: browserTarget.profile,
        profileName: browserTarget.profileName,
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
        await bookmarkSetBrowser(bookmark.id, browserTarget.browser, browserTarget.profile, browserTarget.profileName);
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
          await bookmarkSetBrowser(id, browserTarget.browser, browserTarget.profile, browserTarget.profileName);
        } catch (err) {
          await bookmarkDelete(id).catch((cleanupErr) => console.error(cleanupErr));
          throw err;
        }
        createdId = id;
      }
      onSaved(createdId);
      onClose();
    } catch (err) {
      setError(userMessage(err));
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

  const imageField = !imageSrc && !isEdit ? (
    <button type="button" className="link-button" onClick={handlePickImage}>
      + Добавить картинку
    </button>
  ) : (
    <div className="field">
      <span className="field-label">Картинка</span>
      {imageSrc ? <img className="folder-image-preview" src={imageSrc} alt="" /> : null}
      <div className="field-image-actions">
        <button type="button" className="link-button" onClick={handlePickImage}>
          {image ? "Заменить картинку" : "+ Добавить картинку"}
        </button>
        {isEdit && image ? (
          <button type="button" className="link-button" onClick={handleClearUserImage}>
            Убрать картинку
          </button>
        ) : null}
        {isEdit ? (
          <button
            type="button"
            className="link-button"
            onClick={handleRefreshImage}
            disabled={refreshingImage}
          >
            Обновить
          </button>
        ) : null}
      </div>
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
      <Select
        value={selectedFolderId === null ? "" : String(selectedFolderId)}
        options={[
          { value: "", label: "Booked" },
          ...refs.map((ref) => ({ value: String(ref.id), label: paths.get(ref.id) ?? "" })),
        ]}
        onChange={(v) => setSelectedFolderId(v === "" ? null : Number(v))}
      />
    </label>
  );

  const browserField = (
    <BrowserPicker value={browserTarget} onChange={handleBrowserChange} onDefaultError={setError} />
  );

  const livenessField =
    isEdit && onLivenessChecked ? (
      <LivenessField
        bookmarkId={bookmark.id}
        linkStatus={bookmark.linkStatus}
        linkReason={bookmark.linkReason}
        httpStatus={bookmark.httpStatus}
        lastCheckedAt={bookmark.lastCheckedAt}
        onChecked={onLivenessChecked}
      />
    ) : null;

  const shownError = error || externalError;
  const resolvedAutoFocusField = autoFocusField ?? (isEdit ? undefined : "url");
  const fieldId = useId();
  const urlId = `${fieldId}-url`;
  const urlHintId = `${fieldId}-url-hint`;
  const trimmedUrl = url.trim();
  const urlLooksWrong = urlTouched && trimmedUrl !== "" && !looksLikeHttpUrl(trimmedUrl);
  const urlNote = shownError
    ? { className: "form-error", node: shownError }
    : urlLooksWrong
      ? { className: "field-hint", node: "Похоже, это не адрес страницы. Пример: example.com/страница" }
      : metaFailed
        ? {
            className: "field-hint field-hint-retry",
            node: (
              <>
                Не удалось получить данные страницы ·{" "}
                <button type="button" className="link-button" onClick={retryMetaFetch}>
                  Повторить
                </button>
              </>
            ),
          }
        : urlHint
          ? { className: "field-hint", node: urlHint }
          : null;

  return (
    <form
      className={compact ? "bookmark-form bookmark-form-compact" : "bookmark-form"}
      onSubmit={handleSubmit}
    >
      {!compact ? <h2 id={titleId}>{isEdit ? "Свойства закладки" : "Новая закладка"}</h2> : null}

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

      <div className="field">
        <label className="field-label" htmlFor={urlId}>
          Адрес
          <span className="field-required" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id={urlId}
          value={url}
          required
          aria-describedby={urlNote ? urlHintId : undefined}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setUrlTouched(true)}
          autoFocus={resolvedAutoFocusField === "url"}
          placeholder="example.com/страница"
        />
        {urlNote ? (
          <p className={urlNote.className} id={urlHintId}>
            {urlNote.node}
          </p>
        ) : null}
      </div>

      <label className="field">
        <span className="field-label">
          Название
          {titleAutoFilled ? <span className="field-source-hint">из страницы</span> : null}
        </span>
        <input
          className={
            metaLoading && !isDirty(dirtyRef.current, "title") && !title ? "field-skeleton" : undefined
          }
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          autoFocus={resolvedAutoFocusField === "title"}
        />
      </label>

      {folderField}
      <button type="button" className="link-button" onClick={() => setMoreFieldsOpen((v) => !v)}>
        {moreFieldsOpen ? "Меньше полей" : "Больше полей"}
      </button>
      {moreFieldsOpen ? (
        <>
          {descriptionField}
          {imageField}
          {tagsField}
          {browserField}
          {livenessField}
        </>
      ) : null}

      <div className="form-actions">
        {!trimmedUrl ? <span className="form-actions-reason">Заполните адрес</span> : null}
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" disabled={!trimmedUrl || saving}>
          Сохранить
        </button>
      </div>
    </form>
  );
}
