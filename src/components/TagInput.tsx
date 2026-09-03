import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";

import { tagList } from "../lib/api";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function TagInput({ tags, onChange }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    tagList().then(setSuggestions);
  }, []);

  function addTag(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...tags, trimmed]);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    }
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  const suggestionOptions = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <>
      <div className="tag-input">
        {tags.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button type="button" onClick={() => removeTag(tag)} aria-label={`Убрать тег ${tag}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-input-field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby="tag-input-hint"
          list="tag-suggestions"
        />
        <datalist id="tag-suggestions">
          {suggestionOptions.map((s) => (
            <option value={s} key={s} />
          ))}
        </datalist>
      </div>
      <p className="field-hint" id="tag-input-hint">
        Enter или запятая добавляет тег
      </p>
    </>
  );
}
