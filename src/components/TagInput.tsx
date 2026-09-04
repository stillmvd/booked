import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";

import { tagList } from "../lib/api";
import { Icon } from "./Icon";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

const MAX_SUGGESTIONS = 6;

export function TagInput({ tags, onChange }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    tagList().then(setSuggestions);
  }, []);

  const draftLower = draft.trim().toLowerCase();
  const filtered = draftLower
    ? suggestions
        .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
        .filter((s) => s.toLowerCase().includes(draftLower))
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const open = !dismissed && filtered.length > 0;

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function handleDraftChange(value: string) {
    setDraft(value);
    setActiveIndex(-1);
    setDismissed(false);
  }

  function addTag(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      setActiveIndex(-1);
      return;
    }
    onChange([...tags, trimmed]);
    setDraft("");
    setActiveIndex(-1);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (open && e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= filtered.length ? 0 : i + 1));
      return;
    }
    if (open && e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      return;
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
      return;
    }
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (open && activeIndex >= 0) {
        addTag(filtered[activeIndex]);
      } else {
        addTag(draft);
      }
    }
  }

  const activeId = open && activeIndex >= 0 ? `tag-suggestion-${activeIndex}` : undefined;

  return (
    <>
      <div className="tag-input-wrap">
        <div className="tag-input">
          {tags.map((tag) => (
            <span className="tag-chip" key={tag}>
              <span>{tag}</span>
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Убрать тег ${tag}`}>
                <Icon name="close" />
              </button>
            </span>
          ))}
          <input
            className="tag-input-field"
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setDismissed(false)}
            onBlur={() => setDismissed(true)}
            aria-describedby="tag-input-hint"
            role="combobox"
            aria-expanded={open}
            aria-controls="tag-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={activeId}
          />
        </div>
        {open ? (
          <div className={"tag-suggestions" + (shown ? " open" : "")} role="listbox" id="tag-suggestions">
            {filtered.map((s, i) => (
              <div
                key={s}
                id={`tag-suggestion-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={"tag-suggestion" + (i === activeIndex ? " active" : "")}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => addTag(s)}
              >
                {s}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <p className="field-hint" id="tag-input-hint">
        Enter или запятая добавляет тег
      </p>
    </>
  );
}
