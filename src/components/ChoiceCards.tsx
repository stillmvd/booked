import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { choiceByKey } from "../lib/choiceKeys";

interface Choice<T extends string> {
  value: T;
  title: string;
  description: string;
  risk?: boolean;
}

interface ChoiceCardsProps<T extends string> {
  label: string;
  options: ReadonlyArray<Choice<T>>;
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function ChoiceCards<T extends string>({ label, options, value, disabled, onChange }: ChoiceCardsProps<T>) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const next = choiceByKey(
      options.map((option) => option.value),
      value,
      e.key,
    );
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="dialog-pocket choice-cards" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className={option.risk ? "choice-card choice-card-risk" : "choice-card"}
            ref={(el) => {
              refs.current[option.value] = el;
            }}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
          >
            <span className="choice-card-dot" aria-hidden="true" />
            <span className="choice-card-text">
              <span className="choice-card-title">{option.title}</span>
              <span className="choice-card-desc">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
