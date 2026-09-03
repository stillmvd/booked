import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  folderCreate,
  folderDelete,
  folderListAll,
  folderMove,
  folderUpdate,
  imageImport,
  imagePath,
} from "../lib/api";
import type { Folder, FolderRef } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { TagInput } from "./TagInput";

interface FolderFormProps {
  folder: Folder | null;
  parentId: number | null;
  titleId?: string;
  onClose: () => void;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function buildPaths(refs: FolderRef[]): Map<number, string> {
  const byId = new Map(refs.map((r) => [r.id, r]));
  const paths = new Map<number, string>();

  function pathFor(id: number): string {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const ref = byId.get(id);
    if (!ref) return "";
    const path = ref.parentId === null ? ref.name : `${pathFor(ref.parentId)} / ${ref.name}`;
    paths.set(id, path);
    return path;
  }

  for (const ref of refs) pathFor(ref.id);
  return paths;
}

function descendantIds(refs: FolderRef[], rootId: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const ref of refs) {
    if (ref.parentId === null) continue;
    const list = childrenOf.get(ref.parentId) ?? [];
    list.push(ref.id);
    childrenOf.set(ref.parentId, list);
  }
  const result = new Set<number>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    for (const childId of childrenOf.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

export function FolderForm({ folder, parentId, titleId, onClose, onSaved, onDirtyChange }: FolderFormProps) {
  const isEdit = folder !== null;
  const [name, setName] = useState(folder?.name ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [showDescription, setShowDescription] = useState(Boolean(folder?.description));
  const [image, setImage] = useState<string | null>(folder?.image ?? null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(folder?.tags ?? []);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(
    isEdit ? folder.parentId : parentId,
  );
  const [refs, setRefs] = useState<FolderRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const snapshot = useRef({
    name,
    description,
    image,
    tags: tags.join(","),
    selectedParentId,
  });

  useEffect(() => {
    folderListAll().then(setRefs);
  }, []);

  useEffect(() => {
    if (!onDirtyChange) return;
    const snap = snapshot.current;
    onDirtyChange(
      name !== snap.name ||
        description !== snap.description ||
        image !== snap.image ||
        tags.join(",") !== snap.tags ||
        selectedParentId !== snap.selectedParentId,
    );
  }, [name, description, image, tags, selectedParentId, onDirtyChange]);

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

  const excluded = isEdit ? descendantIds(refs, folder.id) : new Set<number>();
  if (isEdit) excluded.add(folder.id);
  const paths = buildPaths(refs);
  const parentOptions = refs.filter((r) => !excluded.has(r.id));

  async function handlePickImage() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Изображение", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    const filename = await imageImport(picked);
    setImage(filename);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await folderUpdate(folder.id, trimmed, description || null, image, tags);
        if (selectedParentId !== folder.parentId) {
          await folderMove(folder.id, selectedParentId);
        }
      } else {
        const id = await folderCreate(trimmed, selectedParentId);
        try {
          await folderUpdate(id, trimmed, description || null, image, tags);
        } catch (err) {
          await folderDelete(id, "all").catch((cleanupErr) => console.error(cleanupErr));
          throw err;
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="folder-form" onSubmit={handleSubmit}>
      <h2 id={titleId}>{isEdit ? "Свойства папки" : "Новая папка"}</h2>

      <label className="field">
        <span className="field-label">Название</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
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
        <span className="field-label">Родитель</span>
        <select
          value={selectedParentId === null ? "" : String(selectedParentId)}
          onChange={(e) =>
            setSelectedParentId(e.target.value === "" ? null : Number(e.target.value))
          }
        >
          <option value="">Booked</option>
          {parentOptions.map((ref) => (
            <option value={ref.id} key={ref.id}>
              {paths.get(ref.id)}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" disabled={!name.trim() || saving}>
          Сохранить
        </button>
      </div>
    </form>
  );
}
