import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  bookmarkCreate,
  bookmarkDelete,
  bookmarkFindDuplicate,
  bookmarkLinksSet,
  bookmarkSetBrowser,
  bookmarkSetCoverPos,
  bookmarkSetTags,
  bookmarkUpdate,
  browserDefaultGet,
  folderInheritedBrowser,
  folderListAll,
  imageImport,
  imageImportBytes,
  imageImportUrl,
  mediaPath,
  metaFetch,
  previewRefresh,
} from "../lib/api";
import type { Bookmark, BrowserTarget, DuplicateHit, FolderRef, InheritedTarget, PreviewOrigin } from "../lib/types";
import { applyFetched, fallbackTitle, isDirty, markDirty } from "../lib/dirtyFields";
import type { DirtySet, FieldValues } from "../lib/dirtyFields";
import { addLink, fromBookmarkLinks, linksChanged, sameUrl, toLinkInputs } from "../lib/linksEdit";
import type { EditableLink } from "../lib/linksEdit";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { aliveRecent, folderChips } from "../lib/recentFolders";
import type { FolderChoice } from "../lib/recentFolders";
import { displayLabel } from "../lib/platforms";
import { userMessage } from "../lib/userMessage";
import { buildPaths } from "./FolderForm";
import { BrowserPicker } from "./BrowserPicker";
import { CoverField } from "./CoverField";
import { DialogHead, DialogPocket, SubmitMark } from "./DialogHead";
import { DuplicateBanner } from "./DuplicateBanner";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { ImageDrop } from "./ImageDrop";
import { LinksEditor } from "./LinksEditor";
import { QuickUrlField } from "./QuickUrlField";
import { Select } from "./Select";
import { TagInput } from "./TagInput";

const META_DEBOUNCE_MS = 400;

type ExtraField = "description" | "image" | "tags" | "browser";

const EXTRA_FIELDS: { id: ExtraField; label: string; icon: IconName }[] = [
  { id: "description", label: "Описание", icon: "text" },
  { id: "image", label: "Картинка", icon: "image" },
  { id: "tags", label: "Теги", icon: "tag" },
  { id: "browser", label: "Браузер", icon: "globe" },
];

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
  appendUrl?: string;
  recentFolderIds?: FolderChoice[];
  initialFolderRefs?: FolderRef[];
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
  appendUrl,
  recentFolderIds,
  initialFolderRefs,
}: BookmarkFormProps) {
  const isEdit = bookmark !== null;
  const [url, setUrl] = useState(bookmark?.url ?? initialUrl ?? "");
  const [links, setLinks] = useState<EditableLink[]>(() => {
    if (bookmark) {
      const own = fromBookmarkLinks(bookmark.links);
      const appended = appendUrl ? addLink(own, appendUrl) : null;
      return appended?.ok ? appended.links : own;
    }
    if (!initialUrl) return [];
    const seeded = addLink([], initialUrl);
    return seeded.ok ? seeded.links : [];
  });
  const initialLinksRef = useRef(bookmark && appendUrl ? fromBookmarkLinks(bookmark.links) : links);
  const linksRef = useRef(links);
  linksRef.current = links;
  const [linkDraft, setLinkDraft] = useState("");
  const [pos, setPos] = useState({ x: bookmark?.imageX ?? 50, y: bookmark?.imageY ?? 50 });
  const primaryUrl = compact ? url : (links[0]?.url ?? "");
  const [title, setTitle] = useState(bookmark?.title ?? "");
  const [description, setDescription] = useState(bookmark?.description ?? "");
  const [image, setImage] = useState<string | null>(bookmark?.image ?? null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(bookmark?.previewFile ?? null);
  const [previewOrigin, setPreviewOrigin] = useState<PreviewOrigin | null>(
    bookmark?.previewOrigin ?? null,
  );
  const [refreshingImage, setRefreshingImage] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(bookmark?.tags ?? []);
  const [browserTarget, setBrowserTarget] = useState<BrowserTarget>({
    browser: bookmark?.targetBrowser ?? null,
    profile: bookmark?.targetProfile ?? null,
    profileName: bookmark?.targetProfileName ?? null,
  });
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    isEdit ? bookmark.folderId : folderId,
  );
  const [refs, setRefs] = useState<FolderRef[]>(initialFolderRefs ?? []);
  const [extras, setExtras] = useState<Set<ExtraField>>(() => new Set());
  const [inherited, setInherited] = useState<InheritedTarget | null>(null);
  const [duplicate, setDuplicate] = useState<{ hit: DuplicateHit; url: string; gen: number } | null>(null);
  const duplicateGenRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);
  const [moreFieldsOpen, setMoreFieldsOpen] = useState(
    Boolean(bookmark?.description || bookmark?.image || bookmark?.tags.length || bookmark?.targetBrowser),
  );
  const [titleAutoFilled, setTitleAutoFilled] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaFailed, setMetaFailed] = useState(false);

  const linksKey = JSON.stringify(toLinkInputs(links)) + linkDraft.trim();
  const snapshot = useRef({
    url,
    title,
    description,
    image,
    tags: tags.join(","),
    selectedFolderId,
    linksKey: JSON.stringify(toLinkInputs(initialLinksRef.current)),
    pos: `${pos.x},${pos.y}`,
  });

  const dirtyRef = useRef<DirtySet>(
    isEdit ? new Set(["url", "title", "image"] as const) : new Set(),
  );
  const titleRef = useRef(title);
  titleRef.current = title;
  const urlRef = useRef(primaryUrl);
  urlRef.current = primaryUrl;
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

  useEffect(() => {
    if (browserTarget.browser) {
      setInherited(null);
      return;
    }
    let cancelled = false;
    folderInheritedBrowser(selectedFolderId)
      .then((found) => {
        if (!cancelled) setInherited(found);
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, [selectedFolderId, browserTarget.browser]);

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
    const trimmed = primaryUrl.trim();
    if (!trimmed) {
      setDuplicate((prev) => (compact ? null : prev));
      setMetaLoading(false);
      setMetaFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const gen = ++duplicateGenRef.current;
      bookmarkFindDuplicate(trimmed, bookmark?.id ?? null).then((hit) => {
        if (cancelled) return;
        if (hit) showDuplicate(hit, trimmed, gen);
        else setDuplicate((prev) => (prev && prev.url !== trimmed && !compact ? prev : null));
      });
      if (initialLinksRef.current[0]?.url === trimmed && isEdit) return;
      if (looksLikeHttpUrl(trimmed)) {
        runMetaFetch(trimmed);
      }
    }, META_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [primaryUrl, isEdit, bookmark, compact]);

  useEffect(() => {
    if (compact || !duplicate) return;
    if (!links.some((link) => link.url === duplicate.url)) setDuplicate(null);
  }, [links, duplicate, compact]);

  useEffect(() => {
    if (!appendUrl || compact) return;
    const appended = linksRef.current.find(
      (link) => sameUrl(link.url, appendUrl) && !initialLinksRef.current.some((own) => own.url === link.url),
    );
    if (appended) checkAddedLink(appended);
  }, []);

  function showDuplicate(hit: DuplicateHit, url: string, gen: number) {
    setDuplicate((prev) => (prev && prev.gen > gen ? prev : { hit, url, gen }));
  }

  function checkAddedLink(link: EditableLink) {
    const gen = ++duplicateGenRef.current;
    bookmarkFindDuplicate(link.url, bookmark?.id ?? null)
      .then((hit) => {
        if (hit && linksRef.current.some((current) => current.url === link.url)) showDuplicate(hit, link.url, gen);
      })
      .catch((err) => console.error(err));
  }

  const picture = image ?? previewFile;
  const lastPictureRef = useRef(picture);
  useEffect(() => {
    if (lastPictureRef.current === picture) return;
    lastPictureRef.current = picture;
    setPos({ x: 50, y: 50 });
  }, [picture]);

  useEffect(() => {
    if (!onDirtyChange) return;
    const snap = snapshot.current;
    const dirty =
      url !== snap.url ||
      title !== snap.title ||
      description !== snap.description ||
      image !== snap.image ||
      tags.join(",") !== snap.tags ||
      selectedFolderId !== snap.selectedFolderId ||
      linksKey !== snap.linksKey ||
      `${pos.x},${pos.y}` !== snap.pos;
    onDirtyChange(dirty);
  }, [url, title, description, image, tags, selectedFolderId, linksKey, pos, onDirtyChange]);

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

  function toggleExtra(id: ExtraField) {
    setExtras((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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
      filters: [{ name: "Изображение", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    const filename = await imageImport(picked);
    setImage(filename);
    setRefreshNote(null);
    dirtyRef.current = markDirty(dirtyRef.current, "image");
  }

  function handleClearImage() {
    setImage(null);
    dirtyRef.current = markDirty(dirtyRef.current, "image");
  }

  async function handleImageFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const filename = await imageImportBytes(bytes);
      setImage(filename);
      dirtyRef.current = markDirty(dirtyRef.current, "image");
    } catch (err) {
      setError(userMessage(err));
    }
  }

  async function handleImageUrl(url: string) {
    try {
      const filename = await imageImportUrl(url);
      setImage(filename);
      dirtyRef.current = markDirty(dirtyRef.current, "image");
    } catch (err) {
      setError(userMessage(err));
    }
  }

  async function handleRefreshImage() {
    if (!isEdit) return;
    setRefreshingImage(true);
    setRefreshNote(null);
    try {
      const info = await previewRefresh(bookmark.id);
      const same = info.file === previewFile;
      setPreviewFile(info.file);
      setPreviewOrigin(info.origin);
      if (!info.file) setRefreshNote("На странице картинки нет");
      else if (image) {
        setImage(null);
        dirtyRef.current = markDirty(dirtyRef.current, "image");
      } else if (same) setRefreshNote("Картинка на странице не изменилась");
    } catch (err) {
      console.error(err);
      setRefreshNote("Страница не открылась, картинку взять неоткуда");
    } finally {
      setRefreshingImage(false);
    }
  }

  function collectLinks(): EditableLink[] | null {
    if (!linkDraft.trim()) return links;
    const added = addLink(links, linkDraft);
    if (added.ok) return added.links;
    if (links.length > 0 && added.reason === "Эта ссылка уже есть в списке") return links;
    setError(added.reason);
    return null;
  }

  async function saveFull() {
    const finalLinks = collectLinks();
    if (!finalLinks) return;
    if (finalLinks.length === 0) {
      setError("Добавьте хотя бы одну ссылку");
      return;
    }
    setSaving(true);
    setError(null);
    const primary = finalLinks[0].url;
    const trimmedTitle = title.trim();
    const inputs = toLinkInputs(finalLinks);
    const posChanged = pos.x !== (bookmark?.imageX ?? 50) || pos.y !== (bookmark?.imageY ?? 50);
    try {
      if (isEdit) {
        await bookmarkUpdate(bookmark.id, selectedFolderId, trimmedTitle, bookmark.url, description || null, image);
        if (linksChanged(initialLinksRef.current, finalLinks)) await bookmarkLinksSet(bookmark.id, inputs);
        await bookmarkSetTags(bookmark.id, tags);
        await bookmarkSetBrowser(bookmark.id, browserTarget.browser, browserTarget.profile, browserTarget.profileName);
        if (posChanged) await bookmarkSetCoverPos(bookmark.id, pos.x, pos.y);
        onSaved(primary !== bookmark.url ? bookmark.id : undefined);
      } else {
        const id = await bookmarkCreate(selectedFolderId, trimmedTitle, primary, description || null, image);
        try {
          if (finalLinks.length > 1 || inputs[0].label) await bookmarkLinksSet(id, inputs);
          await bookmarkSetTags(id, tags);
          await bookmarkSetBrowser(id, browserTarget.browser, browserTarget.profile, browserTarget.profileName);
          if (posChanged) await bookmarkSetCoverPos(id, pos.x, pos.y);
        } catch (err) {
          await bookmarkDelete(id).catch((cleanupErr) => console.error(cleanupErr));
          throw err;
        }
        onSaved(id);
      }
      onClose();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!compact) {
      await saveFull();
      return;
    }
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
    if (!canSubmit) return;
    await save();
  }

  const imageField = compact ? (
    <div className="field">
      <span className="field-label">Картинка</span>
      <ImageDrop
        src={imageSrc}
        canClear={Boolean(image)}
        onPick={handlePickImage}
        onClear={handleClearImage}
        onFile={handleImageFile}
        onUrl={handleImageUrl}
      />
    </div>
  ) : (
    <div className="field bookmark-photo">
      <CoverField
        src={imageSrc}
        x={pos.x}
        y={pos.y}
        onMove={(x, y) => setPos({ x, y })}
        framable={thumbRenderMode({ image, previewFile, previewOrigin }) === "preview"}
        canClear={Boolean(image)}
        onPick={handlePickImage}
        onClear={handleClearImage}
        onRefresh={isEdit ? handleRefreshImage : undefined}
        refreshing={refreshingImage}
        onFile={handleImageFile}
        onUrl={handleImageUrl}
      />
      {refreshNote ? <span className="field-hint">{refreshNote}</span> : null}
    </div>
  );

  const tagsField = (
    <label className="field">
      <span className="field-label">Теги</span>
      <TagInput tags={tags} onChange={setTags} />
    </label>
  );

  const folderOptions = [
    { value: "", label: "Booked" },
    ...refs.map((ref) => ({ value: String(ref.id), label: paths.get(ref.id) ?? "" })),
  ];

  const folderField = (
    <label className="field">
      <span className="field-label">Папка</span>
      <Select
        value={selectedFolderId === null ? "" : String(selectedFolderId)}
        options={folderOptions}
        onChange={(v) => setSelectedFolderId(v === "" ? null : Number(v))}
      />
    </label>
  );

  const inheritedHint =
    !browserTarget.browser && inherited
      ? `Без своего выбора откроется в «${inherited.target.profileName ?? inherited.target.browser}» — так настроена папка «${inherited.folderName}»`
      : null;

  const browserField = (
    <BrowserPicker
      value={browserTarget}
      onChange={handleBrowserChange}
      onDefaultError={setError}
      hint={inheritedHint}
    />
  );

  const shownError = error || externalError;
  const resolvedAutoFocusField = autoFocusField ?? (isEdit ? undefined : "url");
  const fieldId = useId();
  const urlId = `${fieldId}-url`;
  const urlHintId = `${fieldId}-url-hint`;
  const folderLabelId = `${fieldId}-folder`;
  const trimmedUrl = url.trim();
  const canSubmit = compact ? trimmedUrl !== "" : links.length > 0 || linkDraft.trim() !== "";
  const urlLooksWrong = compact && urlTouched && trimmedUrl !== "" && !looksLikeHttpUrl(trimmedUrl);
  const urlNote = shownError
    ? { className: "form-error", node: shownError }
    : urlLooksWrong
      ? { className: "field-hint", node: "Похоже, это не адрес страницы. Пример: example.com/страница" }
      : metaFailed
        ? {
            className: "field-hint field-hint-retry",
            node: (
              <>
                Не удалось получить данные страницы
                <button type="button" className="link-button" onClick={retryMetaFetch}>
                  <Icon name="reset" />
                  Повторить
                </button>
              </>
            ),
          }
        : urlHint
          ? { className: "field-hint", node: urlHint }
          : null;

  if (compact) {
    const known = new Set(refs.map((ref) => ref.id));
    const recent = aliveRecent(recentFolderIds ?? [], known);
    const chips = folderChips(recent, selectedFolderId);
    const extraFields: Record<ExtraField, ReactNode> = {
      description: (
        <label className="field">
          <span className="field-label">Описание</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} autoFocus />
        </label>
      ),
      image: imageField,
      tags: tagsField,
      browser: browserField,
    };

    return (
      <form className="bookmark-form bookmark-form-compact" onSubmit={handleSubmit}>
        {duplicate ? (
          <DuplicateBanner
            hit={duplicate.hit}
            onGoTo={() => {
              onNavigateToDuplicate(duplicate.hit);
              onClose();
            }}
            onSaveAnyway={save}
          />
        ) : null}

        <DialogPocket>
          <div className="field">
            <QuickUrlField
              id={urlId}
              label="Адрес"
              value={url}
              required
              describedBy={urlNote ? urlHintId : undefined}
              onChange={setUrl}
              onBlur={() => setUrlTouched(true)}
              autoFocus={resolvedAutoFocusField === "url"}
            />
            {urlNote ? (
              <p className={urlNote.className} id={urlHintId}>
                {urlNote.node}
              </p>
            ) : null}
          </div>
          <label
            className={
              "quick-title" + (metaLoading && !isDirty(dirtyRef.current, "title") && !title ? " field-skeleton" : "")
            }
          >
            <input
              className="quick-title-input"
              value={title}
              placeholder="Название"
              aria-label="Название"
              onChange={(e) => handleTitleChange(e.target.value)}
              autoFocus={resolvedAutoFocusField === "title"}
            />
            {titleAutoFilled ? <span className="quick-title-source">из страницы</span> : null}
          </label>
        </DialogPocket>

        <DialogPocket>
          <div className="field">
            <span className="field-label" id={folderLabelId}>
              Папка
            </span>
            <div className="quick-folders" role="group" aria-labelledby={folderLabelId}>
              {chips.map((id) => (
                <button
                  key={id ?? "root"}
                  type="button"
                  className="quick-folder"
                  aria-pressed={id === selectedFolderId}
                  title={id === null ? "Booked" : paths.get(id)}
                  onClick={() => setSelectedFolderId(id)}
                >
                  {id === null ? "Booked" : (refs.find((ref) => ref.id === id)?.name ?? "")}
                </button>
              ))}
              <Select
                value={selectedFolderId === null ? "" : String(selectedFolderId)}
                options={folderOptions}
                onChange={(v) => setSelectedFolderId(v === "" ? null : Number(v))}
                ariaLabel="Другая папка"
                triggerLabel="Другая…"
                triggerClassName="quick-folder quick-folder-more"
                inline
              />
            </div>
          </div>
        </DialogPocket>

        {EXTRA_FIELDS.filter((extra) => extras.has(extra.id)).map((extra) => (
          <DialogPocket key={extra.id}>{extraFields[extra.id]}</DialogPocket>
        ))}

        <div className="form-actions">
          <span className="quick-extras" role="group" aria-label="Больше полей">
            {EXTRA_FIELDS.map((extra) => (
              <button
                key={extra.id}
                type="button"
                className="quick-extra"
                aria-pressed={extras.has(extra.id)}
                aria-label={extra.label}
                title={extra.label}
                onClick={() => toggleExtra(extra.id)}
              >
                <Icon name={extra.icon} />
              </button>
            ))}
          </span>
          {!canSubmit && !urlNote ? <span className="form-actions-reason">Заполните адрес</span> : null}
          <span className="quick-buttons">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" disabled={!canSubmit || saving}>
              Сохранить
              <SubmitMark />
            </button>
          </span>
        </div>
      </form>
    );
  }

  return (
    <form className="bookmark-form dialog" onSubmit={handleSubmit}>
      <DialogHead id={titleId} title={isEdit ? "Свойства закладки" : "Новая закладка"} onClose={onClose} />

      <DialogPocket className="dialog-body">
        {duplicate ? (
          <DuplicateBanner
            hit={duplicate.hit}
            linkLabel={displayLabel(duplicate.url, links.find((link) => link.url === duplicate.url)?.label ?? null)}
            onGoTo={() => {
              onNavigateToDuplicate(duplicate.hit);
              onClose();
            }}
            onSaveAnyway={save}
          />
        ) : null}

        {imageField}

        <DialogPocket>
          <label className="field bookmark-name">
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

          <label className="field bookmark-description">
            <span className="field-label">Описание</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </label>
        </DialogPocket>

        <div className="field">
          <LinksEditor
            links={links}
            onChange={setLinks}
            onAdded={checkAddedLink}
            onAddPending={setLinkDraft}
            autoFocusAdd={!isEdit && links.length === 0 && resolvedAutoFocusField === "url"}
          />
          {urlNote ? <p className={urlNote.className}>{urlNote.node}</p> : null}
        </div>

        <DialogPocket>
          {folderField}
          <button
            type="button"
            className="link-button"
            aria-expanded={moreFieldsOpen}
            onClick={() => setMoreFieldsOpen((v) => !v)}
          >
            {moreFieldsOpen ? "Меньше полей" : "Больше полей"}
            <Icon name="chevron-down" className={moreFieldsOpen ? "link-button-chevron open" : "link-button-chevron"} />
          </button>
        </DialogPocket>
        {moreFieldsOpen ? (
          <>
            <DialogPocket>{tagsField}</DialogPocket>
            <DialogPocket>{browserField}</DialogPocket>
          </>
        ) : null}
      </DialogPocket>

      <div className="form-actions">
        {!canSubmit ? <span className="form-actions-reason">Добавьте ссылку</span> : null}
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" disabled={!canSubmit || saving}>
          Сохранить
          <SubmitMark />
        </button>
      </div>
    </form>
  );
}
