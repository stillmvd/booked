import { useRef } from "react";

import type { Bookmark, DuplicateHit } from "../lib/types";
import { Icon } from "./Icon";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  firstResultId?: string | null;
  firstBookmark?: Bookmark | null;
  hasSelectedTags?: boolean;
  onClearTags?: () => void;
  onOpenBookmark?: (bookmark: Bookmark) => void;
  onNavigateToFolder?: (hit: DuplicateHit) => void;
}

export function SearchField({
  value,
  onChange,
  firstResultId = null,
  firstBookmark = null,
  hasSelectedTags = false,
  onClearTags,
  onOpenBookmark,
  onNavigateToFolder,
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!firstResultId) return;
      e.preventDefault();
      document.getElementById(firstResultId)?.focus();
      return;
    }
    if (e.key === "Enter") {
      if (!firstBookmark) return;
      e.preventDefault();
      if (e.ctrlKey) {
        onNavigateToFolder?.({
          id: firstBookmark.id,
          title: firstBookmark.title,
          folderId: firstBookmark.folderId,
          folderName: null,
        });
      } else {
        onOpenBookmark?.(firstBookmark);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (value.trim() !== "") {
        onChange("");
        return;
      }
      if (hasSelectedTags) onClearTags?.();
    }
  }

  return (
    <div className="search-field">
      <span className="search-field-glyph" aria-hidden="true">
        <Icon name="search" />
      </span>
      <input
        ref={inputRef}
        type="search"
        className="search-field-input"
        aria-label="Поиск по хранилищу"
        placeholder="Поиск по названию, ссылке и тегам…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value ? (
        <button
          type="button"
          className="search-field-clear"
          aria-label="Очистить поле поиска"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}
