import type { KeyboardEvent, RefObject } from "react";

import { Icon } from "./Icon";

interface CmdkHeadProps {
  id?: string;
  title: string;
  onClose: () => void;
}

export function CmdkHead({ id, title, onClose }: CmdkHeadProps) {
  return (
    <div className="cmdk-head">
      <h2 id={id} className="cmdk-pill">
        {title}
      </h2>
      <button type="button" className="dialog-close cmdk-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}

interface CmdkSearchProps {
  inputRef: RefObject<HTMLInputElement | null>;
  listId: string;
  activeId: string | undefined;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function CmdkSearch({ inputRef, listId, activeId, placeholder, value, onChange, onKeyDown }: CmdkSearchProps) {
  return (
    <div className="cmdk-search">
      <input
        ref={inputRef}
        type="text"
        className="cmdk-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="cmdk-search-mark" aria-hidden="true">
        <Icon name="search" />
      </span>
    </div>
  );
}

interface CmdkEmptyProps {
  title: string;
  hint: string;
}

export function CmdkEmpty({ title, hint }: CmdkEmptyProps) {
  return (
    <div className="cmdk-empty">
      <span className="cmdk-empty-mark" aria-hidden="true">
        <Icon name="search" />
      </span>
      <span className="cmdk-empty-title">{title}</span>
      <span className="cmdk-empty-hint">{hint}</span>
    </div>
  );
}
