import { normalizeLinkInput } from "../lib/linksEdit";
import { hostOf } from "../lib/plate";
import { displayLabel, platformForUrl } from "../lib/platforms";
import { Icon, PlatformIcon } from "./Icon";

interface QuickUrlFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  describedBy?: string;
  label: string;
  required?: boolean;
}

export function QuickUrlField({ id, value, onChange, onBlur, autoFocus, describedBy, label, required }: QuickUrlFieldProps) {
  const normalized = normalizeLinkInput(value);
  const platform = normalized ? platformForUrl(normalized) : null;
  const letter = normalized ? hostOf(normalized).charAt(0).toUpperCase() : "";

  return (
    <label className="quick-url">
      <span className="quick-url-icon" aria-hidden="true">
        {!normalized ? <Icon name="link" /> : platform ? <PlatformIcon platform={platform.key} /> : letter}
      </span>
      <input
        id={id}
        className="quick-url-input"
        value={value}
        required={required}
        placeholder="Вставьте адрес страницы"
        aria-label={label}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {normalized ? <span className="quick-url-chip">{displayLabel(normalized, null)}</span> : null}
    </label>
  );
}
