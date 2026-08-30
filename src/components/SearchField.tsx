import { useRef } from "react";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchField({ value, onChange }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="search-field">
      <span className="search-field-glyph" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={inputRef}
        type="search"
        className="search-field-input"
        aria-label="Поиск по хранилищу"
        placeholder="Поиск по названию, ссылке и тегам…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
          ×
        </button>
      ) : null}
    </div>
  );
}
