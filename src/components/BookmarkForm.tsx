import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
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
  folderCreate,
  folderListAll,
  imageImport,
  imageImportBytes,
  imageImportUrl,
  mediaPath,
  metaFetch,
  previewRefresh,
} from "../lib/api";
import type { Bookmark, BrowserTarget, DuplicateHit, FolderRef, PreviewOrigin } from "../lib/types";
import { applyFetched, fallbackTitle, isDirty, markDirty } from "../lib/dirtyFields";
import type { DirtySet, FieldValues } from "../lib/dirtyFields";
import { classifyDrop } from "../lib/imageSource";
import type { ImagePick } from "../lib/imageSource";
import { usePendingImage } from "../lib/usePendingImage";
import { addLink, fromBookmarkLinks, linksChanged, sameUrl, toLinkInputs, withMainUrl } from "../lib/linksEdit";
import type { EditableLink } from "../lib/linksEdit";
import { mediaSrcOf, thumbRenderMode } from "../lib/media";
import { RECENT_FOLDERS_KEY, aliveRecent, pushRecentFolder, sanitizeRecent } from "../lib/recentFolders";
import type { FolderChoice } from "../lib/recentFolders";
import { pluralizeRu } from "../lib/pluralizeRu";
import { readStored, writeStored } from "../lib/storage";
import { displayLabel } from "../lib/platforms";
import { userMessage } from "../lib/userMessage";
import { QuickBrowserPicker } from "./BrowserPicker";
import { CoverField } from "./CoverField";
import { DialogPocket, SubmitMark } from "./DialogHead";
import { DuplicateBanner } from "./DuplicateBanner";
import { Icon } from "./Icon";
import { ImageDrop } from "./ImageDrop";
import { LinksEditor } from "./LinksEditor";
import { QuickUrlField } from "./QuickUrlField";
import { QuickFolderTiles } from "./QuickFolderTiles";
import { QuickFolderTree } from "./QuickFolderTree";
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
  appendUrl?: string;
  pendingImage?: ImagePick;
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
  pendingImage,
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
  const [mainText, setMainText] = useState(() => links[0]?.url ?? "");
  const [linksOpen, setLinksOpen] = useState(Boolean(appendUrl) && !compact);
  const mainApplied = compact || linksOpen ? null : withMainUrl(links, mainText);
  const currentLinks = mainApplied?.ok ? mainApplied.links : links;
  const [pos, setPos] = useState({
    x: bookmark?.imageX ?? 50,
    y: bookmark?.imageY ?? 50,
    zoom: bookmark?.imageZoom ?? 1,
  });
  const primaryUrl = compact ? url : linksOpen ? (links[0]?.url ?? "") : mainText;
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
  const [duplicate, setDuplicate] = useState<{ hit: DuplicateHit; url: string; gen: number } | null>(null);
  const duplicateGenRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);
  const [titleAutoFilled, setTitleAutoFilled] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);

  const linksKey =
    JSON.stringify(toLinkInputs(currentLinks)) +
    (linksOpen ? linkDraft.trim() : mainApplied && !mainApplied.ok ? mainText.trim() : "");
  const snapshot = useRef({
    url,
    title,
    description,
    image,
    tags: tags.join(","),
    selectedFolderId,
    linksKey: JSON.stringify(toLinkInputs(initialLinksRef.current)),
    pos: `${pos.x},${pos.y},${pos.zoom}`,
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
    if (!currentLinks.some((link) => sameUrl(link.url, duplicate.url)) && primaryUrl.trim() !== duplicate.url) setDuplicate(null);
  }, [linksKey, duplicate, compact]);

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
    setPos({ x: 50, y: 50, zoom: 1 });
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
      `${pos.x},${pos.y},${pos.zoom}` !== snap.pos;
    onDirtyChange(compact ? url.trim() !== "" : dirty);
  }, [url, title, description, image, tags, selectedFolderId, linksKey, pos, onDirtyChange, compact]);

  const [storedRecent] = useState<FolderChoice[]>(() => sanitizeRecent(readStored<unknown>(RECENT_FOLDERS_KEY, [])));
  const recentTiles =
    recentFolderIds ?? (refs.length > 0 ? aliveRecent(storedRecent, new Set(refs.map((ref) => ref.id))) : storedRecent);

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
    metaFetch(candidate)
      .then((info) => {
        if (metaFetchGenRef.current !== gen) return;
        setMetaLoading(false);
        if (info.blocked) {
          applyAutoTitle(fallbackTitle(candidate));
          return;
        }
        const fetchedTitle = info.title?.trim() || fallbackTitle(candidate);
        applyAutoTitle(fetchedTitle);
      })
      .catch(() => {
        if (metaFetchGenRef.current !== gen) return;
        setMetaLoading(false);
        applyAutoTitle(fallbackTitle(candidate));
      });
  }

  const dropHandlers = useRef({ handleImageFile, handleImageUrl, setUrl });
  dropHandlers.current = { handleImageFile, handleImageUrl, setUrl };

  useEffect(() => {
    if (!compact) return;
    const root = document.documentElement;
    let depth = 0;
    function carries(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).some((type) => type === "Files" || type === "text/uri-list");
    }
    function handleEnter(e: DragEvent) {
      if (!carries(e)) return;
      e.preventDefault();
      depth += 1;
      root.setAttribute("data-drop-over", "");
    }
    function handleOver(e: DragEvent) {
      if (carries(e)) e.preventDefault();
    }
    function handleLeave(e: DragEvent) {
      if (!carries(e)) return;
      depth = e.relatedTarget === null ? 0 : Math.max(0, depth - 1);
      if (depth === 0) root.removeAttribute("data-drop-over");
    }
    function handleReset() {
      depth = 0;
      root.removeAttribute("data-drop-over");
    }
    function handleDrop(e: DragEvent) {
      if (e.defaultPrevented || !e.dataTransfer || !carries(e)) return;
      e.preventDefault();
      const data = e.dataTransfer;
      const pick = classifyDrop({
        files: data.files,
        items: data.items,
        uriList: data.getData("text/uri-list"),
        text: data.getData("text/plain"),
        html: data.getData("text/html"),
      });
      const act = dropHandlers.current;
      if (pick.kind === "file") {
        void act.handleImageFile(pick.file);
      } else if (pick.kind === "imageUrl") {
        void act.handleImageUrl(pick.url);
      } else if (pick.kind === "link") {
        act.setUrl(pick.url);
      }
    }
    document.addEventListener("dragenter", handleEnter);
    document.addEventListener("dragover", handleOver);
    document.addEventListener("dragleave", handleLeave);
    document.addEventListener("drop", handleReset, true);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("drop", handleReset, true);
      document.removeEventListener("dragenter", handleEnter);
      document.removeEventListener("dragover", handleOver);
      document.removeEventListener("dragleave", handleLeave);
      document.removeEventListener("drop", handleDrop);
      root.removeAttribute("data-drop-over");
    };
  }, [compact]);

  function handleTitleChange(value: string) {
    setTitle(value);
    dirtyRef.current = markDirty(dirtyRef.current, "title");
    setTitleAutoFilled(false);
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

  usePendingImage(pendingImage, handleImageFile, handleImageUrl);

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
    if (!linksOpen) {
      if (mainApplied?.ok) return mainApplied.links;
      setError(mainApplied?.reason ?? null);
      return null;
    }
    if (!linkDraft.trim()) return links;
    const added = addLink(links, linkDraft);
    if (added.ok) return added.links;
    if (links.length > 0 && added.reason === "Эта ссылка уже есть в списке") return links;
    setError(added.reason);
    return null;
  }

  function rememberFolder() {
    writeStored(RECENT_FOLDERS_KEY, pushRecentFolder(sanitizeRecent(readStored<unknown>(RECENT_FOLDERS_KEY, [])), selectedFolderId));
  }

  function openLinks() {
    const applied = withMainUrl(links, mainText);
    if (!applied.ok) {
      setError(applied.reason);
      return;
    }
    setError(null);
    setLinks(applied.links);
    setLinkDraft("");
    setLinksOpen(true);
  }

  function closeLinks() {
    let next = links;
    if (linkDraft.trim()) {
      const added = addLink(links, linkDraft);
      if (added.ok) next = added.links;
      else if (added.reason !== "Эта ссылка уже есть в списке") {
        setError(added.reason);
        return;
      }
    }
    setError(null);
    setLinks(next);
    setMainText(next[0]?.url ?? "");
    setLinkDraft("");
    setLinksOpen(false);
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
    const posChanged =
      pos.x !== (bookmark?.imageX ?? 50) || pos.y !== (bookmark?.imageY ?? 50) || pos.zoom !== (bookmark?.imageZoom ?? 1);
    try {
      if (isEdit) {
        await bookmarkUpdate(bookmark.id, selectedFolderId, trimmedTitle, bookmark.url, description || null, image);
        if (linksChanged(initialLinksRef.current, finalLinks)) await bookmarkLinksSet(bookmark.id, inputs);
        await bookmarkSetTags(bookmark.id, tags);
        await bookmarkSetBrowser(bookmark.id, browserTarget.browser, browserTarget.profile, browserTarget.profileName);
        if (posChanged) await bookmarkSetCoverPos(bookmark.id, pos.x, pos.y, pos.zoom);
        if (selectedFolderId !== bookmark.folderId) rememberFolder();
        onSaved(primary !== bookmark.url ? bookmark.id : undefined);
      } else {
        const id = await bookmarkCreate(selectedFolderId, trimmedTitle, primary, description || null, image);
        try {
          if (finalLinks.length > 1 || inputs[0].label) await bookmarkLinksSet(id, inputs);
          await bookmarkSetTags(id, tags);
          await bookmarkSetBrowser(id, browserTarget.browser, browserTarget.profile, browserTarget.profileName);
          if (posChanged) await bookmarkSetCoverPos(id, pos.x, pos.y, pos.zoom);
        } catch (err) {
          await bookmarkDelete(id).catch((cleanupErr) => console.error(cleanupErr));
          throw err;
        }
        rememberFolder();
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
        onLink={setUrl}
      />
    </div>
  ) : (
    <div className="field bookmark-photo">
      <CoverField
        src={imageSrc}
        x={pos.x}
        y={pos.y}
        zoom={pos.zoom}
        onMove={(x, y, zoom) => setPos({ x, y, zoom })}
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

  const shownError = error || externalError;
  const resolvedAutoFocusField = autoFocusField ?? (isEdit ? undefined : "url");
  const fieldId = useId();
  const urlId = `${fieldId}-url`;
  const urlHintId = `${fieldId}-url-hint`;
  const folderLabelId = `${fieldId}-folder`;
  const fieldText = (compact ? url : mainText).trim();
  const canSubmit = compact
    ? fieldText !== ""
    : linksOpen
      ? links.length > 0 || linkDraft.trim() !== ""
      : fieldText !== "" || links.length > 1;
  const urlLooksWrong = !linksOpen && urlTouched && fieldText !== "" && !looksLikeHttpUrl(fieldText);
  const urlNote = shownError
    ? { className: "form-error", node: shownError }
    : urlLooksWrong
      ? { className: "field-hint", node: "Похоже, это не адрес страницы. Пример: example.com/страница" }
      : urlHint && fieldText === ""
        ? { className: "field-hint", node: urlHint }
        : null;
  const urlNoteNode = urlNote ? (
    <p className={urlNote.className} id={urlHintId}>
      {urlNote.node}
    </p>
  ) : null;

  const extraLinks = links.length - 1;
  const urlNode = linksOpen ? (
    <div className="field">
      <LinksEditor
        links={links}
        onChange={setLinks}
        onAdded={checkAddedLink}
        onAddPending={setLinkDraft}
        autoFocusAdd={links.length === 0}
      />
      {urlNoteNode}
      <button type="button" className="link-button quick-links-toggle" aria-expanded="true" onClick={closeLinks}>
        <Icon name="link" />
        Свернуть ссылки
        <Icon name="chevron-down" className="link-button-chevron open" />
      </button>
    </div>
  ) : (
    <div className="field">
      <QuickUrlField
        id={urlId}
        label="Адрес"
        value={compact ? url : mainText}
        required={compact}
        describedBy={urlNote ? urlHintId : undefined}
        onChange={
          compact
            ? setUrl
            : (text) => {
                setMainText(text);
                setError(null);
              }
        }
        onBlur={() => setUrlTouched(true)}
        autoFocus={resolvedAutoFocusField === "url"}
      />
      {urlNoteNode}
      {compact ? null : (
        <button type="button" className="link-button quick-links-toggle" aria-expanded="false" onClick={openLinks}>
          <Icon name="link" />
          {extraLinks > 0 ? (
            <span>
              Ещё <b>{extraLinks}</b> {pluralizeRu(extraLinks, ["ссылка", "ссылки", "ссылок"])}
            </span>
          ) : (
            "Добавить ссылку"
          )}
          <Icon name={extraLinks > 0 ? "chevron-down" : "plus"} className="link-button-chevron" />
        </button>
      )}
    </div>
  );

  const titleNode = (
    <label
      className={"quick-title" + (metaLoading && !isDirty(dirtyRef.current, "title") && !title ? " field-skeleton" : "")}
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
  );

  const mainNode = (
    <div className="quick-main">
      <DialogPocket>
        {urlNode}
        {compact ? titleNode : null}
      </DialogPocket>

      {linksOpen ? (
        <button type="button" className="quick-folder-summary" aria-expanded="false" onClick={closeLinks}>
          <Icon name="folder" />
          <span className="quick-folder-summary-label">Папка</span>
          <span className="quick-folder-summary-name">
            {selectedFolderId === null ? "Booked" : (refs.find((ref) => ref.id === selectedFolderId)?.name ?? "Booked")}
          </span>
          <Icon name="chevron-down" className="quick-folder-summary-chevron" />
        </button>
      ) : null}

      {linksOpen ? null : (
        <QuickFolderTiles recent={recentTiles} selected={selectedFolderId} onSelect={setSelectedFolderId} />
      )}

      <DialogPocket className={linksOpen ? "quick-folder-pocket quick-folder-off" : "quick-folder-pocket"}>
        <div className="field">
          <span className="field-label quick-hidden-label" id={folderLabelId}>
            Папка
          </span>
          <QuickFolderTree
            refs={refs}
            selected={selectedFolderId}
            labelId={folderLabelId}
            onSelect={setSelectedFolderId}
            onCreate={async (name, parentId) => {
              const id = await folderCreate(name, parentId);
              setSelectedFolderId(id);
              setRefs(await folderListAll().catch(() => refs));
            }}
          />
        </div>
      </DialogPocket>
    </div>
  );

  const sideNode = (
    <DialogPocket className="quick-side">
      {imageField}
      <div className="field">
        <textarea
          className="quick-desc"
          value={description}
          placeholder="Описание"
          aria-label="Описание"
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <label className="field">
        <span className="field-label">Теги</span>
        <TagInput tags={tags} onChange={setTags} placeholder="Добавить тег" />
      </label>
      <QuickBrowserPicker value={browserTarget} onChange={handleBrowserChange} />
    </DialogPocket>
  );

  const actionsNode = (
    <div className="form-actions">
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
  );

  const duplicateNode = duplicate ? (
    <DuplicateBanner
      hit={duplicate.hit}
      linkLabel={
        compact ? undefined : displayLabel(duplicate.url, currentLinks.find((link) => link.url === duplicate.url)?.label ?? null)
      }
      onGoTo={() => {
        onNavigateToDuplicate(duplicate.hit);
        onClose();
      }}
      onSaveAnyway={save}
    />
  ) : null;

  if (compact) {
    return (
      <form className="bookmark-form bookmark-form-compact" onSubmit={handleSubmit}>
        {duplicateNode}
        {mainNode}
        {sideNode}
        {actionsNode}
      </form>
    );
  }

  return (
    <form className="bookmark-form dialog bookmark-form-wide" onSubmit={handleSubmit}>
      <div className="dialog-head bookmark-head">
        <h2 id={titleId} className="quick-hidden-label">
          {isEdit ? "Свойства закладки" : "Новая закладка"}
        </h2>
        {titleNode}
        <button type="button" className="dialog-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {duplicateNode}
      {mainNode}
      {sideNode}
      {actionsNode}
    </form>
  );
}
