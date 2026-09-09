import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import {
  gameSetImage,
  gameSetTags,
  gameSetTitle,
  gameSetVersion,
  imageImport,
  imageImportBytes,
  imageImportUrl,
  mediaPath,
} from "../lib/api";
import type { Game } from "../lib/types";
import { userMessage } from "../lib/userMessage";
import { ImageDrop } from "./ImageDrop";
import { TagInput } from "./TagInput";

interface GameFormProps {
  game: Game;
  suggestions: string[];
  titleId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function GameForm({ game, suggestions, titleId, onClose, onSaved }: GameFormProps) {
  const [title, setTitle] = useState(game.title);
  const [version, setVersion] = useState(game.versionInstalled ?? "");
  const [tags, setTags] = useState<string[]>(game.tags);
  const [image, setImage] = useState<string | null>(game.image);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!image) {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    mediaPath(["images", image]).then((full) => {
      if (!cancelled) setImageSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [image]);

  async function handlePickImage() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Изображение", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    try {
      setImage(await imageImport(picked));
    } catch (err) {
      setError(userMessage(err));
    }
  }

  async function handleImageFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setImage(await imageImportBytes(bytes));
    } catch (err) {
      setError(userMessage(err));
    }
  }

  async function handleImageUrl(url: string) {
    try {
      setImage(await imageImportUrl(url));
    } catch (err) {
      setError(userMessage(err));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const nextTitle = title.trim();
    if (nextTitle === "") {
      setError("Без названия карточку не сохранить.");
      return;
    }
    const nextVersion = version.trim() === "" ? null : version.trim();
    setSaving(true);
    setError(null);
    try {
      if (nextTitle !== game.title) await gameSetTitle(game.id, nextTitle);
      if (nextVersion !== game.versionInstalled) await gameSetVersion(game.id, nextVersion);
      const tagsChanged =
        tags.length !== game.tags.length || tags.some((tag, index) => tag !== game.tags[index]);
      if (tagsChanged) await gameSetTags(game.id, tags);
      if (image !== game.image) await gameSetImage(game.id, image);
      onSaved();
    } catch (err) {
      setError(userMessage(err));
      setSaving(false);
    }
  }

  return (
    <form className="game-form" onSubmit={submit}>
      <h2 id={titleId}>Изменить «{game.title}»</h2>

      <div className="field">
        <span className="field-label">Обложка</span>
        <ImageDrop
          src={imageSrc}
          canClear={image !== null}
          onPick={handlePickImage}
          onClear={() => setImage(null)}
          onFile={handleImageFile}
          onUrl={handleImageUrl}
        />
      </div>

      <label className="field">
        <span className="field-label">Название</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>

      <label className="field">
        <span className="field-label">Версия</span>
        <input
          value={version}
          placeholder={game.folderName ? "как в названии папки" : "не определена"}
          onChange={(e) => setVersion(e.target.value)}
        />
      </label>

      <div className="field">
        <span className="field-label">Теги</span>
        <TagInput tags={tags} suggestions={suggestions} onChange={setTags} />
      </div>

      {error ? <p className="games-warning">{error}</p> : null}

      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="submit" disabled={saving}>
          Сохранить
        </button>
      </div>
    </form>
  );
}
