import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { browserDefaultGet, browserDefaultSet, browserList, mediaPath } from "../lib/api";
import { avatarRelPath } from "../lib/media";
import { plate } from "../lib/plate";
import type { BrowserEntry, BrowserTarget } from "../lib/types";
import { BrowserIcon } from "./BrowserIcon";

interface BrowserPickerProps {
  value: BrowserTarget;
  onChange: (target: BrowserTarget) => void;
  onDefaultError?: (message: string) => void;
}

interface Row {
  key: string;
  label: string;
  target: BrowserTarget;
  kind: "none" | "browser" | "profile";
  browserKey: string;
  browserName?: string;
  avatarFile?: string | null;
  iconKey?: string | null;
}

const NONE_TARGET: BrowserTarget = { browser: null, profile: null, profileName: null };

function browserKeyOf(name: string): string {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join("-");
}

function targetsMatch(a: BrowserTarget, b: BrowserTarget): boolean {
  if (!a.browser || !b.browser) return false;
  return browserKeyOf(a.browser) === browserKeyOf(b.browser) && (a.profile ?? null) === (b.profile ?? null);
}

function ProfileAvatar({ avatarFile, profileKey, letter }: { avatarFile: string | null | undefined; profileKey: string; letter: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    if (!avatarFile) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    mediaPath(avatarRelPath(avatarFile)).then((full) => {
      if (!cancelled) setSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [avatarFile]);

  const swatch = plate(profileKey);
  const showImg = loaded && src;

  return (
    <span className="browser-avatar" style={showImg ? undefined : { background: swatch.bg }}>
      {src && (
        <img
          className="browser-avatar-img"
          src={src}
          alt=""
          style={loaded ? undefined : { display: "none" }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
      )}
      {!showImg && (
        <span className="browser-avatar-letter" style={{ color: swatch.fg }}>
          {letter}
        </span>
      )}
    </span>
  );
}

export function BrowserPicker({ value, onChange, onDefaultError }: BrowserPickerProps) {
  const [entries, setEntries] = useState<BrowserEntry[]>([]);
  const [defaultTarget, setDefaultTarget] = useState<BrowserTarget>(NONE_TARGET);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    browserList().then(setEntries);
    browserDefaultGet().then(setDefaultTarget);
  }, []);

  async function handleDefaultToggle(checked: boolean) {
    const next = checked ? value : NONE_TARGET;
    try {
      await browserDefaultSet(next);
      setDefaultTarget(next);
    } catch (err) {
      onDefaultError?.(err instanceof Error ? err.message : String(err));
    }
  }

  const rows: Row[] = [
    { key: "", label: "Без назначения — как обычно", target: NONE_TARGET, kind: "none", browserKey: "" },
  ];
  for (const entry of entries) {
    rows.push({
      key: entry.key,
      label: entry.name,
      target: { browser: entry.name, profile: null, profileName: null },
      kind: "browser",
      browserKey: entry.key,
      iconKey: entry.iconKey,
    });
    for (const profile of entry.profiles) {
      rows.push({
        key: `${entry.key}::${profile.key}`,
        label: profile.name,
        target: { browser: entry.name, profile: profile.key, profileName: profile.name },
        kind: "profile",
        browserKey: entry.key,
        browserName: entry.name,
        avatarFile: profile.avatarFile,
      });
    }
  }

  const selectedBrowserKey = value.browser ? browserKeyOf(value.browser) : "";
  const selectedProfile = value.profile ?? null;
  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => {
      if (row.kind === "none") return selectedBrowserKey === "";
      if (row.browserKey !== selectedBrowserKey) return false;
      const rowProfile = row.kind === "profile" ? row.target.profile : null;
      return rowProfile === selectedProfile;
    }),
  );

  function selectIndex(index: number) {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    onChange(rows[clamped].target);
    rowRefs.current[clamped]?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectIndex(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectIndex(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      selectIndex(rows.length - 1);
    }
  }

  return (
    <div className="field browser-field">
      <span className="field-label">Браузер</span>
      <div className="browser-list" role="radiogroup" aria-label="Браузер и профиль">
        {rows.map((row, index) => {
          const selected = index === selectedIndex;
          const isDefault = targetsMatch(row.target, defaultTarget);
          const ariaLabel = row.kind === "profile" ? `${row.browserName}, профиль ${row.label}` : undefined;
          const className =
            "browser-option" +
            (row.kind === "browser" ? " browser-option-group-start" : "") +
            (row.kind === "profile" ? " browser-option-profile" : "");
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={ariaLabel}
              key={row.key}
              tabIndex={selected ? 0 : -1}
              className={className}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              onClick={() => onChange(row.target)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              {row.kind === "profile" ? (
                <ProfileAvatar
                  avatarFile={row.avatarFile}
                  profileKey={row.key}
                  letter={row.label.charAt(0).toUpperCase()}
                />
              ) : row.kind === "browser" ? (
                <BrowserIcon iconKey={row.iconKey} name={row.label} />
              ) : (
                <span className="browser-option-icon-slot" aria-hidden="true" />
              )}
              <span className="browser-option-label">{row.label}</span>
              {isDefault ? <span className="browser-option-default-tag">по умолчанию</span> : null}
              {selected ? (
                <span className="browser-option-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {entries.length === 0 ? (
        <p className="browser-empty">Другие браузеры не найдены на этом компьютере</p>
      ) : null}
      <div className={"browser-default-row" + (value.browser ? "" : " browser-default-row-disabled")}>
        <label>
          <input
            type="checkbox"
            checked={targetsMatch(value, defaultTarget)}
            disabled={!value.browser}
            onChange={(e) => handleDefaultToggle(e.target.checked)}
          />
          Сделать вариантом по умолчанию для новых закладок
        </label>
      </div>
    </div>
  );
}
